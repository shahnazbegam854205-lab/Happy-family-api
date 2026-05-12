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

function removeOwnerField(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => removeOwnerField(item));
  }
  
  const newObj = {};
  for (const key in obj) {
    if (key === 'owner') continue;
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      newObj[key] = removeOwnerField(obj[key]);
    } else {
      newObj[key] = obj[key];
    }
  }
  return newObj;
}

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

// 🔥 MAIN FUNCTION TO CONVERT IGFOLLOWS RESPONSE TO OLD FORMAT
function convertIgfollowsToOldFormat(igfollowsData) {
  if (!igfollowsData || !igfollowsData.result || !igfollowsData.result.results) {
    return [];
  }
  
  // Remove duplicates based on id
  const uniqueMap = new Map();
  igfollowsData.result.results.forEach(record => {
    const id = record.id || record.MOBILE;
    if (!uniqueMap.has(id)) {
      uniqueMap.set(id, {
        name: (record.NAME || "").trim(),
        fname: (record.fname || "").trim(),
        address: (record.ADDRESS || "").replace(/!/g, ', ').replace(/\./g, '').trim(),
        alt: record.alt || "",
        circle: record.circle || "",
        id: record.id || "",
        mobile: record.MOBILE || "",
        email: record.email || "",
        uid: record.id || "",
        id_db: record.id ? String(record.id) : ""
      });
    }
  });
  
  return Array.from(uniqueMap.values());
}

export default async function handler(req, res) {
  try {
    const method = req.method.toUpperCase();
    const input = method === "POST" ? (req.body || {}) : (req.query || {});

    const number = (input.number || input.mobile || "").toString().trim();
    const aadhaarInput = (input.aadhaar || input.id || "").toString().trim();
    const term = (input.term || input.query || number || aadhaarInput || "").toString().trim();
    const type = (input.type || "").toString().trim().toLowerCase();

    // ✅ CORRECT KEYS
    const IGFOLLOWS_KEY = "Happy4321";
    const SUBHXCOSMO_KEY = "suryanshrootx";

    if (!term && !number && !aadhaarInput) {
      return res.status(400).json({
        success: false,
        message: "Please send `number`, `aadhaar` or `term`.",
        example: { 
          number: "7033223687",
          aadhaar: "874233077025",
          term: "UP32AB1234"
        }
      });
    }

    const resultData = {
      number_info: [],
      ration: [],
      aadhar: [],
      other_types: []
    };

    const processedIds = new Set();
    const foundIds = [];

    // 🔥 STEP 1: OTHER TYPES (Same as before)
    if (type && !['mobile', 'id_number', 'id_family'].includes(type)) {
      const otherTypeUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=${encodeURIComponent(type)}&term=${encodeURIComponent(term)}`;
      const rOtherType = await fetchWithTimeout(otherTypeUrl);
      
      if (rOtherType.ok && rOtherType.data) {
        const cleanedData = removeOwnerField(rOtherType.data);
        resultData.other_types.push({
          type: type,
          term: term,
          data: cleanedData
        });
      }
    }

    // 🔥 STEP 2: MOBILE NUMBER SEARCH (Using new IGFOLLOWS API)
    if (number) {
      // Call new IGFOLLOWS API
      const igfollowsUrl = `https://api.igfollows.site/num-info/?key=${IGFOLLOWS_KEY}&number=${encodeURIComponent(number)}`;
      console.log(`Calling IGFOLLOWS API: ${igfollowsUrl}`);
      
      const igresponse = await fetchWithTimeout(igfollowsUrl);
      
      if (igresponse.ok && igresponse.data) {
        // Convert to old format
        const convertedData = convertIgfollowsToOldFormat(igresponse.data);
        
        if (convertedData.length > 0) {
          resultData.number_info = convertedData;
          
          // Extract IDs for further processing
          convertedData.forEach(item => {
            if (item.id && item.id.length >= 12 && !processedIds.has(item.id)) {
              foundIds.push(item.id);
              processedIds.add(item.id);
            }
          });
        }
      }
      
      // If IGFOLLOWS failed or no data, try backup API
      if (resultData.number_info.length === 0) {
        const backupUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=mobile&term=${encodeURIComponent(number)}`;
        const rBackup = await fetchWithTimeout(backupUrl);
        
        if (rBackup.ok && rBackup.data?.success && rBackup.data?.result?.results) {
          const backupResults = rBackup.data.result.results.map(d => ({
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
          
          resultData.number_info = backupResults;
          
          backupResults.forEach(item => {
            if (item.id && item.id.length >= 12 && !processedIds.has(item.id)) {
              foundIds.push(item.id);
              processedIds.add(item.id);
            }
          });
        }
      }

      // Fetch Aadhaar and Ration from found IDs
      for (const id of foundIds) {
        // Aadhaar fetch
        const aadharUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(id)}`;
        const rAadhar = await fetchWithTimeout(aadharUrl);
        
        if (rAadhar.ok && rAadhar.data?.success) {
          const cleanedData = removeOwnerField(rAadhar.data);
          resultData.aadhar.push({
            id: id,
            data: cleanedData
          });
        }

        // Ration fetch
        const rationUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(id)}`;
        const rRation = await fetchWithTimeout(rationUrl);
        
        if (rRation.ok && rRation.data?.success) {
          const cleanedData = removeOwnerField(rRation.data);
          resultData.ration.push({
            id: id,
            data: cleanedData
          });
        }
      }
    }

    // 🔥 STEP 3: AADHAAR SEARCH
    if (aadhaarInput && aadhaarInput !== number) {
      if (!processedIds.has(aadhaarInput)) {
        const aadharUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(aadhaarInput)}`;
        const rAadhar = await fetchWithTimeout(aadharUrl);
        
        if (rAadhar.ok && rAadhar.data?.success) {
          const cleanedData = removeOwnerField(rAadhar.data);
          resultData.aadhar.push({
            id: aadhaarInput,
            data: cleanedData
          });
        }

        const rationUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(aadhaarInput)}`;
        const rRation = await fetchWithTimeout(rationUrl);
        
        if (rRation.ok && rRation.data?.success) {
          const cleanedData = removeOwnerField(rRation.data);
          resultData.ration.push({
            id: aadhaarInput,
            data: cleanedData
          });
        }
        
        processedIds.add(aadhaarInput);
      }
    }

    // 🔥 STEP 4: TERM SEARCH (No type specified)
    if (term && !type && !number && !aadhaarInput) {
      const detectedType = detectInputType(term);
      
      if (detectedType === 'mobile') {
        const igfollowsUrl = `https://api.igfollows.site/num-info/?key=${IGFOLLOWS_KEY}&number=${encodeURIComponent(term)}`;
        const igresponse = await fetchWithTimeout(igfollowsUrl);
        
        if (igresponse.ok && igresponse.data) {
          const convertedData = convertIgfollowsToOldFormat(igresponse.data);
          if (convertedData.length > 0) {
            resultData.number_info = convertedData;
            
            convertedData.forEach(item => {
              if (item.id && item.id.length >= 12 && !processedIds.has(item.id)) {
                foundIds.push(item.id);
                processedIds.add(item.id);
              }
            });
          }
        }
        
        for (const id of foundIds) {
          const aadharUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(id)}`;
          const rAadhar = await fetchWithTimeout(aadharUrl);
          if (rAadhar.ok && rAadhar.data?.success) {
            resultData.aadhar.push({ id: id, data: removeOwnerField(rAadhar.data) });
          }
          
          const rationUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(id)}`;
          const rRation = await fetchWithTimeout(rationUrl);
          if (rRation.ok && rRation.data?.success) {
            resultData.ration.push({ id: id, data: removeOwnerField(rRation.data) });
          }
        }
      } else if (detectedType === 'id_number' || detectedType === 'id_family') {
        const aadharUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(term)}`;
        const rAadhar = await fetchWithTimeout(aadharUrl);
        if (rAadhar.ok && rAadhar.data?.success) {
          resultData.aadhar.push({ id: term, data: removeOwnerField(rAadhar.data) });
        }
        
        const rationUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(term)}`;
        const rRation = await fetchWithTimeout(rationUrl);
        if (rRation.ok && rRation.data?.success) {
          resultData.ration.push({ id: term, data: removeOwnerField(rRation.data) });
        }
      } else {
        const otherUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=${encodeURIComponent(detectedType)}&term=${encodeURIComponent(term)}`;
        const rOther = await fetchWithTimeout(otherUrl);
        if (rOther.ok && rOther.data) {
          resultData.other_types.push({
            type: detectedType,
            term: term,
            data: removeOwnerField(rOther.data)
          });
        }
      }
    }

    // 🔥 FINAL RESPONSE (Exactly like before)
    const anyGood =
      resultData.number_info.length > 0 ||
      resultData.ration.length > 0 ||
      resultData.aadhar.length > 0 ||
      resultData.other_types.length > 0;

    const summary = {
      number_info_count: resultData.number_info.length,
      aadhar_count: resultData.aadhar.length,
      ration_count: resultData.ration.length,
      other_types_count: resultData.other_types.length,
      ids_found: Array.from(processedIds)
    };

    return res.status(200).json({
      success: Boolean(anyGood),
      message: anyGood ? "Data retrieved successfully." : "No data found.",
      summary: summary,
      data: resultData
    });

  } catch (e) {
    console.error("Handler error:", e);
    return res.status(500).json({
      success: false,
      message: "Server error: " + e.message
    });
  }
}
