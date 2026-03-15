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

// 🔥 FUNCTION TO REMOVE OWNER FIELD
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

// 🔥 ID EXTRACT KARNE KA FUNCTION
function extractIdsFromMobileResponse(mobileData) {
  const ids = new Set();
  
  if (mobileData?.data && Array.isArray(mobileData.data)) {
    mobileData.data.forEach(item => {
      if (item.id && item.id.length >= 12) {
        ids.add(item.id);
      }
    });
  }
  
  return Array.from(ids);
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

    const IGFOLLOWS_KEY = "Happy";
    const SUBHXCOSMO_KEY = "suryanshrootx";

    if (!term && !number && !aadhaarInput) {
      return res.status(400).json({
        success: false,
        message: "Please send `number`, `aadhaar` or `term`.",
        example: { 
          number: "9016178226",
          aadhaar: "207596040042",
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

    // 🔥 TRACK KARNE KE LIYE
    const processedIds = new Set();
    const foundIds = [];

    // Detected type
    const detectedType = type || detectInputType(term || number || aadhaarInput);

    // 🔥 STEP 1: OTHER TYPES
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

    // 🔥 STEP 2: AGAR MOBILE NUMBER DIYA HAI
    if (number) {
      // 2.1 Mobile info fetch karo
      const mobileInfoUrl = `http://api.igfollows.site/num-info/?key=${IGFOLLOWS_KEY}&number=${encodeURIComponent(number)}`;
      let rMobileInfo = await fetchWithTimeout(mobileInfoUrl);

      if (!rMobileInfo.ok || !rMobileInfo.data?.data?.length) {
        const backupUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=mobile&term=${encodeURIComponent(number)}`;
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
          
          mobileResults.forEach(item => {
            resultData.number_info.push(item);
            if (item.id && item.id.length >= 12 && !processedIds.has(item.id)) {
              foundIds.push(item.id);
              processedIds.add(item.id);
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
        
        mobileResults.forEach(item => {
          resultData.number_info.push(item);
          if (item.id && item.id.length >= 12 && !processedIds.has(item.id)) {
            foundIds.push(item.id);
            processedIds.add(item.id);
          }
        });
      }

      // 🔥 2.2 Mobile se mile IDs se Aadhaar aur Ration fetch karo
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

    // 🔥 STEP 3: AGAR AADHAAR ID DIYA HAI
    if (aadhaarInput && aadhaarInput !== number) {
      if (!processedIds.has(aadhaarInput)) {
        // Aadhaar info fetch karo
        const aadharUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(aadhaarInput)}`;
        const rAadhar = await fetchWithTimeout(aadharUrl);
        
        if (rAadhar.ok && rAadhar.data?.success) {
          const cleanedData = removeOwnerField(rAadhar.data);
          resultData.aadhar.push({
            id: aadhaarInput,
            data: cleanedData
          });
        }

        // Aadhaar se ration fetch karo
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

    // 🔥 STEP 4: AGAR TERM DIYA HAI AUR TYPE NAHI
    if (term && !type && !number && !aadhaarInput) {
      const detectedType = detectInputType(term);
      
      if (detectedType === 'mobile') {
        // Mobile number se IDs nikaalo
        const mobileUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=mobile&term=${encodeURIComponent(term)}`;
        const rMobile = await fetchWithTimeout(mobileUrl);
        
        if (rMobile.ok && rMobile.data?.success && rMobile.data?.result?.results) {
          const mobileResults = rMobile.data.result.results.map(d => ({
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
          
          mobileResults.forEach(item => {
            resultData.number_info.push(item);
            if (item.id && item.id.length >= 12 && !processedIds.has(item.id)) {
              foundIds.push(item.id);
              processedIds.add(item.id);
            }
          });
          
          // IDs se Aadhaar aur Ration
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
        }
      } else if (detectedType === 'id_number' || detectedType === 'id_family') {
        // Direct ID se fetch
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
        // Other type
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

    // 🔥 FINAL RESPONSE
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
    return res.status(500).json({
      success: false,
      message: "Server error: " + e.message
    });
  }
}
