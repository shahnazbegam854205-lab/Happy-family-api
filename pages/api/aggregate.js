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

export default async function handler(req, res) {
  try {
    const method = req.method.toUpperCase();
    const input = method === "POST" ? (req.body || {}) : (req.query || {});

    const number = (input.number || input.mobile || "").toString().trim();
    const aadhaarInput = (input.aadhaar || input.id || "").toString().trim();

    // ✅ API KEYS
    const IGFOLLOWS_KEY = "Happy";           // Mobile info ke liye backup
    const SUBHXCOSMO_KEY = "suryanshrootx";  // Main API

    if (!number && !aadhaarInput) {
      return res.status(400).json({
        success: false,
        message: "कृपया `number` (mobile) या `aadhaar` (id) भेजें।",
        example: { 
          number: "9016178226",
          aadhaar: "207596040042" 
        }
      });
    }

    const resultData = {
      number_info: [],  // Mobile numbers ki info
      ration: [],       // Ration card info (id_family)
      aadhar: []        // Aadhaar info (id_number)
    };

    // Track karega ki kaunsi IDs process ho chuki hain (duplicate避免 ke liye)
    const processedIds = new Set();
    const processedMobiles = new Set();
    
    // Sab IDs aur mobiles store karne ke liye
    let allIdsToProcess = [];
    let allMobilesToProcess = [];

    // 🔄 STEP 1: AGAR MOBILE NUMBER DIYA HAI
    if (number) {
      allMobilesToProcess.push(number);
    }

    // 🔄 STEP 2: AGAR AADHAAR ID DIYA HAI
    if (aadhaarInput) {
      allIdsToProcess.push(aadhaarInput);
    }

    // 🔄 STEP 3: PEHLE AADHAR IDs PROCESS KARO (TAKI MOBILES MIL SAKEIN)
    if (allIdsToProcess.length > 0) {
      for (const idVal of allIdsToProcess) {
        if (processedIds.has(idVal)) continue;
        processedIds.add(idVal);

        // Parallel calls for Aadhaar and Ration data
        const [aadharResponse, rationResponse] = await Promise.all([
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(idVal)}`),
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(idVal)}`)
        ]);

        // Aadhaar data process karo
        if (aadharResponse.ok && aadharResponse.data?.success) {
          resultData.aadhar.push({
            id: idVal,
            data: aadharResponse.data
          });
          
          // Aadhaar response se saare mobile numbers nikaalo
          const mobilesFromAadhar = extractMobileNumbersFromAadharResponse(aadharResponse.data);
          mobilesFromAadhar.forEach(m => {
            if (!processedMobiles.has(m)) {
              allMobilesToProcess.push(m);
            }
          });
        }

        // Ration data process karo
        if (rationResponse.ok && rationResponse.data?.success) {
          resultData.ration.push({
            id: idVal,
            data: rationResponse.data
          });
        }
      }
    }

    // 🔄 STEP 4: AB SAARE MOBILE NUMBERS PROCESS KARO
    if (allMobilesToProcess.length > 0) {
      for (const mobileNum of uniqStrings(allMobilesToProcess)) {
        if (processedMobiles.has(mobileNum)) continue;
        processedMobiles.add(mobileNum);

        // Pehle IGFOLLOWS try karo, nahi to SUBHXCOSMO
        const mobileInfoUrl = `http://api.igfollows.site/num-info/?key=${IGFOLLOWS_KEY}&number=${encodeURIComponent(mobileNum)}`;
        let rMobileInfo = await fetchWithTimeout(mobileInfoUrl);

        // Agar IGFOLLOWS se data nahi mila to SUBHXCOSMO try karo
        if (!rMobileInfo.ok || !rMobileInfo.data?.data?.length) {
          const backupUrl = `https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=mobile&term=${encodeURIComponent(mobileNum)}`;
          rMobileInfo = await fetchWithTimeout(backupUrl);
          
          // SUBHXCOSMO ka response format
          if (rMobileInfo.ok && rMobileInfo.data?.success && rMobileInfo.data?.result?.results) {
            // Mobile info store karo
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
            
            // Sirf unique entries add karo (mobile + id ke base par)
            mobileResults.forEach(newItem => {
              const exists = resultData.number_info.some(existing => 
                existing.mobile === newItem.mobile && existing.id === newItem.id
              );
              if (!exists) {
                resultData.number_info.push(newItem);
              }
            });
            
            // Naye IDs mili? Unhe bhi process karo
            const newIds = mobileResults.map(d => d.id).filter(Boolean);
            newIds.forEach(id => {
              if (!processedIds.has(id) && !allIdsToProcess.includes(id)) {
                allIdsToProcess.push(id);
              }
            });
          }
        } 
        // IGFOLLOWS ka response
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
          
          // Sirf unique entries add karo
          mobileResults.forEach(newItem => {
            const exists = resultData.number_info.some(existing => 
              existing.mobile === newItem.mobile && existing.id === newItem.id
            );
            if (!exists) {
              resultData.number_info.push(newItem);
            }
          });
          
          // Naye IDs
          const newIds = mobileResults.map(d => d.id).filter(Boolean);
          newIds.forEach(id => {
            if (!processedIds.has(id) && !allIdsToProcess.includes(id)) {
              allIdsToProcess.push(id);
            }
          });
        }
      }
    }

    // 🔄 STEP 5: AGAR NAYE IDs mile hain (mobile responses se), TO UNHE BHI PROCESS KARO
    if (allIdsToProcess.length > 0) {
      for (const idVal of uniqStrings(allIdsToProcess)) {
        if (processedIds.has(idVal)) continue;
        processedIds.add(idVal);

        // Parallel calls for Aadhaar and Ration data
        const [aadharResponse, rationResponse] = await Promise.all([
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_number&term=${encodeURIComponent(idVal)}`),
          fetchWithTimeout(`https://api.subhxcosmo.in/api?key=${SUBHXCOSMO_KEY}&type=id_family&term=${encodeURIComponent(idVal)}`)
        ]);

        if (aadharResponse.ok && aadharResponse.data?.success) {
          // Check for duplicate before pushing
          const exists = resultData.aadhar.some(item => item.id === idVal);
          if (!exists) {
            resultData.aadhar.push({
              id: idVal,
              data: aadharResponse.data
            });
          }
          
          // Aur mobiles? Unhe bhi add karo agar naye hain
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
            resultData.ration.push({
              id: idVal,
              data: rationResponse.data
            });
          }
        }
      }
    }

    // 🔄 STEP 6: FINAL RESPONSE - Bilkul pehle jaisa
    const anyGood =
      resultData.number_info.length > 0 ||
      resultData.ration.length > 0 ||
      resultData.aadhar.length > 0;

    // Summary info
    const summary = {
      total_ids_processed: processedIds.size,
      total_mobiles_processed: processedMobiles.size,
      number_info_count: resultData.number_info.length,
      aadhar_count: resultData.aadhar.length,
      ration_count: resultData.ration.length,
      unique_ids: Array.from(processedIds),
      unique_mobiles: Array.from(processedMobiles)
    };

    return res.status(200).json({
      success: Boolean(anyGood),
      message: anyGood
        ? "सभी endpoints से डेटा प्राप्त हुआ।"
        : "कोई डेटा नहीं मिला।",
      summary: summary,
      data: resultData,
      developer: "Happy 😊 with Cross-Referencing"
    });

  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Server error: " + e.message
    });
  }
}
