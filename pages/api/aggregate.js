const DEFAULT_TIMEOUT = 9000;
const RETRY_COUNT = 1;
const MAX_RESPONSE_SIZE = 4 * 1024 * 1024; // 4MB limit
const MAX_ITEMS_PER_TYPE = 50; // Max 50 items per type

async function fetchWithTimeout(url, opts = {}, timeout = DEFAULT_TIMEOUT, retry = RETRY_COUNT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(timer);

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }

    return { ok: res.ok, status: res.status, data: json };
  } catch (err) {
    clearTimeout(timer);
    if (retry > 0) {
      await new Promise(r => setTimeout(r, 300));
      return fetchWithTimeout(url, opts, timeout, retry - 1);
    }
    return { ok: false, error: err.message || String(err) };
  }
}

function uniqStrings(arr) {
  return Array.from(new Set(arr.filter(Boolean).map(String)));
}

// 🔥 RECURSIVE FUNCTION TO REMOVE OWNER FIELD
function removeOwnerField(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => removeOwnerField(item)).slice(0, MAX_ITEMS_PER_TYPE);
  }
  
  const newObj = {};
  for (const key in obj) {
    if (key === 'owner') {
      continue;
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      newObj[key] = removeOwnerField(obj[key]);
    } else {
      newObj[key] = obj[key];
    }
  }
  return newObj;
}

// 🔥 TRUNCATE LARGE ARRAYS
function truncateLargeData(data, type) {
  if (!data) return data;
  
  if (Array.isArray(data)) {
    if (data.length > MAX_ITEMS_PER_TYPE) {
      return {
        total: data.length,
        truncated: true,
        items: data.slice(0, MAX_ITEMS_PER_TYPE),
        message: `Showing first ${MAX_ITEMS_PER_TYPE} of ${data.length} items`
      };
    }
    return data;
  }
  
  if (typeof data === 'object') {
    const truncated = {};
    for (const key in data) {
      if (Array.isArray(data[key]) && data[key].length > MAX_ITEMS_PER_TYPE) {
        truncated[key] = {
          total: data[key].length,
          truncated: true,
          items: data[key].slice(0, MAX_ITEMS_PER_TYPE),
          message: `Showing first ${MAX_ITEMS_PER_TYPE} of ${data[key].length} items`
        };
      } else if (typeof data[key] === 'object' && data[key] !== null) {
        truncated[key] = truncateLargeData(data[key], type);
      } else {
        truncated[key] = data[key];
      }
    }
    return truncated;
  }
  
  return data;
}

// 🔥 ESTIMATE RESPONSE SIZE
function estimateSize(obj) {
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
  } catch {
    return 0;
  }
}

// Mobile numbers extract karne ke liye helper
function extractMobileNumbersFromAadharResponse(aadharData) {
  const mobiles = [];
  if (aadharData?.success && Array.isArray(aadharData?.result)) {
    aadharData.result.slice(0, MAX_ITEMS_PER_TYPE).forEach(item => {
      if (item.mobile && item.mobile.length >= 10) {
        mobiles.push(item.mobile);
      }
      if (item.alt && item.alt.length >= 10) {
        mobiles.push(item.alt);
      }
    });
  }
  return uniqStrings(mobiles).slice(0, MAX_ITEMS_PER_TYPE);
}

// Type detect karne ka helper
function detectInputType(input) {
  const value = input.toString().trim();
  
  if (/^\d{10}$/.test(value)) return "mobile";
  if (/^\d{12}$/.test(value)) return "id_number";
  if (/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(value)) return "pan";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "email";
  if (/^[A-Z]{2}[0-9]{1,2}[A-Z]{1,2}[0-9]{1,4}$/.test(value)) return "vehicle_num";
  if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(value)) return "ifsc";
  if (/^[A-Z0-9]{21}$/.test(value)) return "cinc";
  if (/^[^\s@]+@[^\s@]+$/.test(value) || /^\d{10}@[a-zA-Z]+$/.test(value)) return "upi";
  if (/^\d{14}$/.test(value)) return "samagra";
  if (/^92[0-9]{10}$/.test(value)) return "pak_num";
  if (/^\d{12,14}$/.test(value)) return "id_family";
  
  return "id_number";
}

export default async function handler(req, res) {
  try {
    const method = req.method.toUpperCase();
    const input = method === "POST" ? (req.body || {}) : (req.query || {});

    const number = (input.number || input.mobile || "").toString().trim();
    const aadhaarInput = (input.aadhaar || input.id || "").toString().trim();
    const term = (input.term || input.query || number || aadhaarInput || "").toString().trim();
    const type = (input.type || "").toString().trim().toLowerCase();
    
    // 🔥 PAGINATION PARAMETERS
    const page = parseInt(input.page) || 1;
    const limit = parseInt(input.limit) || 20;

    // ✅ API KEYS
    const IGFOLLOWS_KEY = "Happy";
    const SUBHXCOSMO_KEY = "suryanshrootx";

    if (!term && !number && !aadhaarInput) {
      return res.status(400).json({
        success: false,
        message: "Please send `number`, `aadhaar` or `term`.",
        example: { 
          number: "9016178226",
          aadhaar: "207596040042",
          term: "UP32AB1234",
          type: "vehicle_num"
        }
      });
    }

    const resultData = {
      number_info: [],
      ration: [],
      aadhar: [],
      other_types: []
    };

    // Track processed items
    const processedIds = new Set();
    const processedMobiles = new Set();
    
    let allIdsToProcess = [];
    let allMobilesToProcess = [];

    const detectedType = type || detectInputType(term || number || aadhaarInput);

    // 🔥 STEP 1: OTHER TYPES with owner removal
    if (type && !['mobile', 'id_number', 'id_family'].includes(type)) {
      const otherTypeUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=${encodeURIComponent(type)}&term=${encodeURIComponent(term)}`;
      const rOtherType = await fetchWithTimeout(otherTypeUrl);
      
      if (rOtherType.ok && rOtherType.data) {
        const cleanedData = removeOwnerField(rOtherType.data);
        const truncatedData = truncateLargeData(cleanedData, type);
        
        resultData.other_types.push({
          type: type,
          term: term,
          data: truncatedData
        });
      }
    }

    // STEP 2: MOBILE NUMBER
    if (number) {
      allMobilesToProcess.push(number);
    }

    // STEP 3: AADHAAR ID
    if (aadhaarInput) {
      allIdsToProcess.push(aadhaarInput);
    }

    // STEP 4: PROCESS AADHAR IDs
    if (allIdsToProcess.length > 0) {
      for (const idVal of allIdsToProcess.slice(0, 10)) { // Max 10 IDs
        if (processedIds.has(idVal)) continue;
        processedIds.add(idVal);

        const [aadharResponse, rationResponse] = await Promise.all([
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(idVal)}`),
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(idVal)}`)
        ]);

        if (aadharResponse.ok && aadharResponse.data?.success) {
          const cleanedData = removeOwnerField(aadharResponse.data);
          const truncatedData = truncateLargeData(cleanedData, 'aadhar');
          
          resultData.aadhar.push({
            id: idVal,
            data: truncatedData
          });
          
          const mobilesFromAadhar = extractMobileNumbersFromAadharResponse(aadharResponse.data);
          mobilesFromAadhar.slice(0, 5).forEach(m => { // Max 5 mobiles per ID
            if (!processedMobiles.has(m)) {
              allMobilesToProcess.push(m);
            }
          });
        }

        if (rationResponse.ok && rationResponse.data?.success) {
          const cleanedData = removeOwnerField(rationResponse.data);
          const truncatedData = truncateLargeData(cleanedData, 'ration');
          
          resultData.ration.push({
            id: idVal,
            data: truncatedData
          });
        }
      }
    }

    // STEP 5: PROCESS MOBILE NUMBERS
    if (allMobilesToProcess.length > 0) {
      for (const mobileNum of uniqStrings(allMobilesToProcess).slice(0, 10)) { // Max 10 mobiles
        if (processedMobiles.has(mobileNum)) continue;
        processedMobiles.add(mobileNum);

        const mobileInfoUrl = `http://api.igfollows.site/num-info/?key=${IGFOLLOWS_KEY}&number=${encodeURIComponent(mobileNum)}`;
        let rMobileInfo = await fetchWithTimeout(mobileInfoUrl);

        if (!rMobileInfo.ok || !rMobileInfo.data?.data?.length) {
          const backupUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=mobile&term=${encodeURIComponent(mobileNum)}`;
          rMobileInfo = await fetchWithTimeout(backupUrl);
          
          if (rMobileInfo.ok && rMobileInfo.data?.success && rMobileInfo.data?.result?.results) {
            const mobileResults = rMobileInfo.data.result.results
              .slice(0, limit)
              .map(d => ({
                name: d.name || "",
                fname: d.fname || "",
                address: d.address || "",
                alt: d.alt || "",
                circle: d.circle || "",
                id: d.id || "",
                mobile: d.mobile || "",
                email: d.email || "",
                uid: d.id || "",
                id_db: d.id ? String(d.id) : ""
              }));
            
            mobileResults.forEach(newItem => {
              const exists = resultData.number_info.some(existing => 
                existing.mobile === newItem.mobile && existing.id === newItem.id
              );
              if (!exists && newItem.mobile) {
                resultData.number_info.push(newItem);
              }
            });
            
            const newIds = mobileResults.map(d => d.id).filter(Boolean).slice(0, 3);
            newIds.forEach(id => {
              if (!processedIds.has(id) && !allIdsToProcess.includes(id)) {
                allIdsToProcess.push(id);
              }
            });
          }
        } 
        else if (rMobileInfo.ok && rMobileInfo.data?.data?.length) {
          const mobileResults = rMobileInfo.data.data
            .slice(0, limit)
            .map(d => ({
              name: d.name || "",
              fname: d.fname || "",
              address: d.address || "",
              alt: d.alt_mobile || "",
              circle: d.circle || "",
              id: d.id || "",
              mobile: d.mobile || "",
              email: d.email || "",
              uid: d.id || "",
              id_db: d.id ? String(d.id) : ""
            }));
          
          mobileResults.forEach(newItem => {
            const exists = resultData.number_info.some(existing => 
              existing.mobile === newItem.mobile && existing.id === newItem.id
            );
            if (!exists && newItem.mobile) {
              resultData.number_info.push(newItem);
            }
          });
          
          const newIds = mobileResults.map(d => d.id).filter(Boolean).slice(0, 3);
          newIds.forEach(id => {
            if (!processedIds.has(id) && !allIdsToProcess.includes(id)) {
              allIdsToProcess.push(id);
            }
          });
        }
      }
    }

    // 🔥 CHECK RESPONSE SIZE
    let finalResponse = {
      success: resultData.number_info.length > 0 || 
               resultData.ration.length > 0 || 
               resultData.aadhar.length > 0 || 
               resultData.other_types.length > 0,
      message: "Data retrieved successfully.",
      summary: {
        total_ids_processed: processedIds.size,
        total_mobiles_processed: processedMobiles.size,
        number_info_count: resultData.number_info.length,
        aadhar_count: resultData.aadhar.length,
        ration_count: resultData.ration.length,
        other_types_count: resultData.other_types.length,
        page: page,
        limit: limit,
        has_more: resultData.number_info.length >= limit || 
                  resultData.aadhar.length >= limit || 
                  resultData.ration.length >= limit
      },
      data: resultData
    };

    // 🔥 AGAR RESPONSE BADA HAI TO COMPRESS KARO
    const responseSize = estimateSize(finalResponse);
    if (responseSize > MAX_RESPONSE_SIZE) {
      // Data truncate karo
      finalResponse.data.number_info = finalResponse.data.number_info.slice(0, 10);
      finalResponse.data.aadhar = finalResponse.data.aadhar.slice(0, 5);
      finalResponse.data.ration = finalResponse.data.ration.slice(0, 5);
      finalResponse.data.other_types = finalResponse.data.other_types.slice(0, 3);
      
      finalResponse.summary.truncated = true;
      finalResponse.summary.message = "Response truncated due to size limit";
    }

    return res.status(200).json(finalResponse);

  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Server error: " + e.message
    });
  }
}
