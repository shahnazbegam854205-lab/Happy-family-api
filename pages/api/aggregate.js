const DEFAULT_TIMEOUT = 9000;
const RETRY_COUNT = 1;

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

// Helper to remove owner field from API response
function removeOwnerField(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const newObj = Array.isArray(obj) ? [] : {};
  
  for (const key in obj) {
    if (key === 'owner') {
      // Skip owner field
      continue;
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      // Recursively clean nested objects
      newObj[key] = removeOwnerField(obj[key]);
    } else {
      newObj[key] = obj[key];
    }
  }
  
  return newObj;
}

// Mobile numbers extract karne ke liye helper
function extractMobileNumbersFromAadharResponse(aadharData) {
  const mobiles = [];
  if (aadharData?.success && Array.isArray(aadharData?.result)) {
    aadharData.result.forEach(item => {
      if (item.mobile && item.mobile.length >= 10) {
        mobiles.push(item.mobile);
      }
      if (item.alt && item.alt.length >= 10) {
        mobiles.push(item.alt);
      }
    });
  }
  return uniqStrings(mobiles);
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

    // Response data structure - other_types nahi dikhega
    const resultData = {
      number_info: [],
      ration: [],
      aadhar: []
    };
    
    // 🔥 INTERNAL STORAGE - other_types ka data yahan store hoga (response mein nahi jayega)
    const internalOtherTypes = [];

    // Track processed items
    const processedIds = new Set();
    const processedMobiles = new Set();
    
    // Arrays to process
    let allIdsToProcess = [];
    let allMobilesToProcess = [];

    // 🔥 STEP 1: AGAR KOI SPECIFIC TYPE DIYA HAI (other_types ke liye - INTERNAL)
    if (type && !['mobile', 'id_number', 'id_family'].includes(type)) {
      console.log(`Processing other type: ${type} with term: ${term}`);
      const otherTypeUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=${encodeURIComponent(type)}&term=${encodeURIComponent(term)}`;
      const rOtherType = await fetchWithTimeout(otherTypeUrl);
      
      if (rOtherType.ok && rOtherType.data) {
        // Owner field hatao
        const cleanedData = removeOwnerField(rOtherType.data);
        
        // INTERNALLY store karo - response mein nahi jayega
        internalOtherTypes.push({
          type: type,
          term: term,
          data: cleanedData,
          timestamp: new Date().toISOString()
        });
        
        console.log(`Other type data stored internally for: ${type}`);
      }
    }

    // STEP 2: AGAR MOBILE NUMBER DIYA HAI
    if (number) {
      allMobilesToProcess.push(number);
    }

    // STEP 3: AGAR AADHAAR ID DIYA HAI
    if (aadhaarInput) {
      allIdsToProcess.push(aadhaarInput);
    }

    // STEP 4: PEHLE AADHAR IDs PROCESS KARO
    if (allIdsToProcess.length > 0) {
      for (const idVal of allIdsToProcess) {
        if (processedIds.has(idVal)) continue;
        processedIds.add(idVal);

        const [aadharResponse, rationResponse] = await Promise.all([
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(idVal)}`),
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(idVal)}`)
        ]);

        // Aadhaar data process karo - owner hatao
        if (aadharResponse.ok && aadharResponse.data?.success) {
          const cleanedData = removeOwnerField(aadharResponse.data);
          
          resultData.aadhar.push({
            id: idVal,
            data: cleanedData
          });
          
          const mobilesFromAadhar = extractMobileNumbersFromAadharResponse(aadharResponse.data);
          mobilesFromAadhar.forEach(m => {
            if (!processedMobiles.has(m)) {
              allMobilesToProcess.push(m);
            }
          });
        }

        // Ration data process karo - owner hatao
        if (rationResponse.ok && rationResponse.data?.success) {
          const cleanedData = removeOwnerField(rationResponse.data);
          
          resultData.ration.push({
            id: idVal,
            data: cleanedData
          });
        }
      }
    }

    // STEP 5: AB SAARE MOBILE NUMBERS PROCESS KARO
    if (allMobilesToProcess.length > 0) {
      for (const mobileNum of uniqStrings(allMobilesToProcess)) {
        if (processedMobiles.has(mobileNum)) continue;
        processedMobiles.add(mobileNum);

        const mobileInfoUrl = `http://api.igfollows.site/num-info/?key=${IGFOLLOWS_KEY}&number=${encodeURIComponent(mobileNum)}`;
        let rMobileInfo = await fetchWithTimeout(mobileInfoUrl);

        if (!rMobileInfo.ok || !rMobileInfo.data?.data?.length) {
          const backupUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=mobile&term=${encodeURIComponent(mobileNum)}`;
          rMobileInfo = await fetchWithTimeout(backupUrl);
          
          if (rMobileInfo.ok && rMobileInfo.data?.success && rMobileInfo.data?.result?.results) {
            const mobileResults = rMobileInfo.data.result.results.map(d => ({
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
            
            const newIds = mobileResults.map(d => d.id).filter(Boolean);
            newIds.forEach(id => {
              if (!processedIds.has(id) && !allIdsToProcess.includes(id)) {
                allIdsToProcess.push(id);
              }
            });
          }
        } 
        else if (rMobileInfo.ok && rMobileInfo.data?.data?.length) {
          const mobileResults = rMobileInfo.data.data.map(d => ({
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
          
          const newIds = mobileResults.map(d => d.id).filter(Boolean);
          newIds.forEach(id => {
            if (!processedIds.has(id) && !allIdsToProcess.includes(id)) {
              allIdsToProcess.push(id);
            }
          });
        }
      }
    }

    // STEP 6: AGAR NAYE IDs mile hain, TO UNHE BHI PROCESS KARO
    if (allIdsToProcess.length > 0) {
      for (const idVal of uniqStrings(allIdsToProcess)) {
        if (processedIds.has(idVal)) continue;
        processedIds.add(idVal);

        const [aadharResponse, rationResponse] = await Promise.all([
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(idVal)}`),
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(idVal)}`)
        ]);

        if (aadharResponse.ok && aadharResponse.data?.success) {
          const exists = resultData.aadhar.some(item => item.id === idVal);
          if (!exists) {
            const cleanedData = removeOwnerField(aadharResponse.data);
            resultData.aadhar.push({
              id: idVal,
              data: cleanedData
            });
          }
          
          const mobilesFromAadhar = extractMobileNumbersFromAadharResponse(aadharResponse.data);
          mobilesFromAadhar.forEach(m => {
            if (!processedMobiles.has(m) && !allMobilesToProcess.includes(m)) {
              allMobilesToProcess.push(m);
            }
          });
        }

        if (rationResponse.ok && rationResponse.data?.success) {
          const exists = resultData.ration.some(item => item.id === idVal);
          if (!exists) {
            const cleanedData = removeOwnerField(rationResponse.data);
            resultData.ration.push({
              id: idVal,
              data: cleanedData
            });
          }
        }
      }
    }

    // Final response
    const anyGood =
      resultData.number_info.length > 0 ||
      resultData.ration.length > 0 ||
      resultData.aadhar.length > 0 ||
      internalOtherTypes.length > 0;

    const summary = {
      total_ids_processed: processedIds.size,
      total_mobiles_processed: processedMobiles.size,
      number_info_count: resultData.number_info.length,
      aadhar_count: resultData.aadhar.length,
      ration_count: resultData.ration.length,
      other_types_count: internalOtherTypes.length,  // Internal count
      unique_ids: Array.from(processedIds),
      unique_mobiles: Array.from(processedMobiles)
    };

    // 🔥 Agar aap chahein to internalOtherTypes ko response ke header ya metadata mein bhej sakte hain
    // Example: res.setHeader('X-Other-Types-Count', internalOtherTypes.length);

    return res.status(200).json({
      success: Boolean(anyGood),
      message: anyGood
        ? "Data retrieved from all endpoints successfully."
        : "No data found.",
      summary: summary,
      data: resultData,  // other_types nahi dikhega
      supported_types: [
        "mobile", "id_number", "id_family", "pak_num", "ifsc", "cinc",
        "vehicle", "email", "pan", "fampay", "vehicle_num", "upi",
        "sms", "samagra", "upi_bomber", "bomber", "tg", "a2p", "custom_sms"
      ]
    });

  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Server error: " + e.message
    });
  }
}
