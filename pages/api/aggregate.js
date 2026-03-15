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

// 🔥 SIRF OWNER FIELD HATANE KA FUNCTION
function removeOwnerField(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => removeOwnerField(item));
  }
  
  const newObj = {};
  for (const key in obj) {
    if (key === 'owner') continue; // Sirf owner field hatao
    if (typeof obj[key] === 'object' && obj[key] !== null) {
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

    const resultData = {
      number_info: [],
      ration: [],
      aadhar: [],
      other_types: []
    };

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
      // Mobile info fetch karo
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
        });
      }

      // Mobile se aadhaar fetch karo
      const aadharUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(number)}`;
      const rAadhar = await fetchWithTimeout(aadharUrl);
      
      if (rAadhar.ok && rAadhar.data?.success) {
        const cleanedData = removeOwnerField(rAadhar.data);
        resultData.aadhar.push({
          id: number,
          data: cleanedData
        });
      }

      // Mobile se ration fetch karo
      const rationUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(number)}`;
      const rRation = await fetchWithTimeout(rationUrl);
      
      if (rRation.ok && rRation.data?.success) {
        const cleanedData = removeOwnerField(rRation.data);
        resultData.ration.push({
          id: number,
          data: cleanedData
        });
      }
    }

    // 🔥 STEP 3: AGAR AADHAAR ID DIYA HAI
    if (aadhaarInput && aadhaarInput !== number) {
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
    }

    // 🔥 STEP 4: AGAR TERM DIYA HAI AUR TYPE NAHI (AUTO-DETECT)
    if (term && !type && !number && !aadhaarInput) {
      const detectedType = detectInputType(term);
      
      if (detectedType === 'mobile') {
        // Mobile info
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
          });
        }
      } else if (detectedType === 'id_number') {
        // Aadhaar info
        const aadharUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(term)}`;
        const rAadhar = await fetchWithTimeout(aadharUrl);
        
        if (rAadhar.ok && rAadhar.data?.success) {
          const cleanedData = removeOwnerField(rAadhar.data);
          resultData.aadhar.push({
            id: term,
            data: cleanedData
          });
        }
      } else if (detectedType === 'id_family') {
        // Ration info
        const rationUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(term)}`;
        const rRation = await fetchWithTimeout(rationUrl);
        
        if (rRation.ok && rRation.data?.success) {
          const cleanedData = removeOwnerField(rRation.data);
          resultData.ration.push({
            id: term,
            data: cleanedData
          });
        }
      } else {
        // Other type
        const otherUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=${encodeURIComponent(detectedType)}&term=${encodeURIComponent(term)}`;
        const rOther = await fetchWithTimeout(otherUrl);
        
        if (rOther.ok && rOther.data) {
          const cleanedData = removeOwnerField(rOther.data);
          resultData.other_types.push({
            type: detectedType,
            term: term,
            data: cleanedData
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
      other_types_count: resultData.other_types.length
    };

    return res.status(200).json({
      success: Boolean(anyGood),
      message: anyGood
        ? "Data retrieved successfully."
        : "No data found.",
      summary: summary,
      data: resultData
      // ✅ NO supported_types FIELD
    });

  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Server error: " + e.message
    });
  }
}
