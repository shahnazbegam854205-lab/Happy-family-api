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

// 🔥 RECURSIVE FUNCTION TO REMOVE OWNER FIELD FROM ANY OBJECT
function removeOwnerField(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => removeOwnerField(item));
  }
  
  const newObj = {};
  for (const key in obj) {
    if (key === 'owner') {
      // Skip owner field completely
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

    // Response data structure
    const resultData = {
      number_info: [],
      ration: [],
      aadhar: []
    };
    
    // 🔥 INTERNAL STORAGE - other_types ka data yahan store hoga
    const internalOtherTypes = [];

    // Track processed items
    const processedIds = new Set();
    const processedMobiles = new Set();
    
    // Arrays to process
    let allIdsToProcess = [];
    let allMobilesToProcess = [];

    // 🔥 STEP 1: AGAR KOI SPECIFIC TYPE DIYA HAI (including other types)
    if (type) {
      // For mobile, id_number, id_family - ye already alag se handle hote hain
      // Lekin inme bhi owner field nahi honi chahiye
      
      if (type === 'mobile' && !number) {
        // Mobile type ke liye term use karo
        const mobileUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=mobile&term=${encodeURIComponent(term)}`;
        const rMobile = await fetchWithTimeout(mobileUrl);
        
        if (rMobile.ok && rMobile.data) {
          const cleanedData = removeOwnerField(rMobile.data);
          
          // Extract mobile info
          if (cleanedData?.success && cleanedData?.result?.results) {
            const mobileResults = cleanedData.result.results.map(d => ({
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
          }
        }
      }
      else if (type === 'id_number') {
        const idUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(term)}`;
        const rId = await fetchWithTimeout(idUrl);
        
        if (rId.ok && rId.data) {
          const cleanedData = removeOwnerField(rId.data);
          resultData.aadhar.push({
            id: term,
            data: cleanedData
          });
        }
      }
      else if (type === 'id_family') {
        const familyUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(term)}`;
        const rFamily = await fetchWithTimeout(familyUrl);
        
        if (rFamily.ok && rFamily.data) {
          const cleanedData = removeOwnerField(rFamily.data);
          resultData.ration.push({
            id: term,
            data: cleanedData
          });
        }
      }
      else {
        // 🔥 OTHER TYPES - INTERNAL STORAGE
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
          
          // 🔥 Agar koi specific other type ka data directly response mein dalna ho
          // to aap niche code uncomment kar sakte hain:
          
          // if (type === 'pan') {
          //   if (!resultData.pan) resultData.pan = [];
          //   resultData.pan.push(cleanedData);
          // }
          // else if (type === 'vehicle_num') {
          //   if (!resultData.vehicle) resultData.vehicle = [];
          //   resultData.vehicle.push(cleanedData);
          // }
        }
      }
    }

    // STEP 2: AGAR MOBILE NUMBER DIYA HAI (aur type specify nahi kiya)
    if (number && !type) {
      allMobilesToProcess.push(number);
    }

    // STEP 3: AGAR AADHAAR ID DIYA HAI (aur type specify nahi kiya)
    if (aadhaarInput && !type) {
      allIdsToProcess.push(aadhaarInput);
    }

    // STEP 4: AGAR TERM DIYA HAI BUT TYPE NAHI (auto-detect)
    if (term && !type && !number && !aadhaarInput) {
      const detectedType = detectInputType(term);
      
      if (detectedType === 'mobile') {
        allMobilesToProcess.push(term);
      } else if (detectedType === 'id_number' || detectedType === 'id_family') {
        allIdsToProcess.push(term);
      } else {
        // Other type - internal store
        const otherUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=${encodeURIComponent(detectedType)}&term=${encodeURIComponent(term)}`;
        const rOther = await fetchWithTimeout(otherUrl);
        
        if (rOther.ok && rOther.data) {
          const cleanedData = removeOwnerField(rOther.data);
          internalOtherTypes.push({
            type: detectedType,
            term: term,
            data: cleanedData
          });
        }
      }
    }

    // STEP 5: PROCESS AADHAR IDs
    if (allIdsToProcess.length > 0) {
      for (const idVal of allIdsToProcess) {
        if (processedIds.has(idVal)) continue;
        processedIds.add(idVal);

        const [aadharResponse, rationResponse] = await Promise.all([
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(idVal)}`),
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(idVal)}`)
        ]);

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

        if (rationResponse.ok && rationResponse.data?.success) {
          const cleanedData = removeOwnerField(rationResponse.data);
          resultData.ration.push({
            id: idVal,
            data: cleanedData
          });
        }
      }
    }

    // STEP 6: PROCESS MOBILE NUMBERS
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
            // Owner field already nahi hai mobile results mein, but still safe side ke liye
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

    // STEP 7: AGAR NAYE IDs mile hain
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
      other_types_count: internalOtherTypes.length,
      unique_ids: Array.from(processedIds),
      unique_mobiles: Array.from(processedMobiles)
    };

    // ✅ FINAL RESPONSE - WITHOUT supported_types AND WITHOUT owner
    return res.status(200).json({
      success: Boolean(anyGood),
      message: anyGood
        ? "Data retrieved successfully."
        : "No data found.",
      summary: summary,
      data: resultData
      // ✅ supported_types COMPLETELY HATAYA
    });

  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Server error: " + e.message
    });
  }
}
