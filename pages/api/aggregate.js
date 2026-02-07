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

export default async function handler(req, res) {
  try {
    const method = req.method.toUpperCase();
    const input = method === "POST" ? (req.body || {}) : (req.query || {});

    const number = (input.number || input.mobile || "").toString().trim();
    const aadhaarInput = (input.aadhaar || input.id || "").toString().trim();

    const ALLAPI_KEY = process.env.ALLAPI_KEY || "DEMOKEY";
    const RATION_KEY = process.env.RATION_KEY || "paidchx";
    const SPLEXXO_KEY = process.env.SPLEXXO_KEY || "SPLEXXO222_3"; // ✅ NEW API KEY

    if (!number && !aadhaarInput) {
      return res.status(400).json({
        success: false,
        message: "कृपया `number` (mobile) या `aadhaar` (id) भेजें।",
        example: { number: "9016178226" }
      });
    }

    const resultData = {
      number_info: [],
      ration: [],
      aadhar: []
    };

    let idsToProcess = [];

    // 🔄 STEP 1: ✅ NEW SPLEXXO API (V2) - Puraani API hata di
    if (number && !aadhaarInput) {
      // ✅ YEH NAYA API ENDPOINT USE KARO
      const numberInfoUrl = `https://splexxo-api.vercel.app/api?number=${encodeURIComponent(number)}&key=${encodeURIComponent(SPLEXXO_KEY)}`;
      const rNumberInfo = await fetchWithTimeout(numberInfoUrl);

      // ✅ NAYE API KA RESPONSE FORMAT HANDLE KARO
      if (rNumberInfo.ok && rNumberInfo.data && 
          rNumberInfo.data.status === "success" && 
          rNumberInfo.data.data && 
          rNumberInfo.data.data.success === true) {
        
        const apiData = rNumberInfo.data.data;
        
        // ✅ Naya format: data.result array me data hai
        if (apiData && Array.isArray(apiData.result) && apiData.result.length > 0) {
          // ✅ Sabhi results ko number_info me add karo
          resultData.number_info = apiData.result.map(d => ({
            name: d.name || "",
            fname: d.father_name || "",
            address: d.address || "",
            alt: d.alt_mobile || "",
            circle: d.circle || "",
            id: d.id_number || "",  // Aadhaar ID
            mobile: d.mobile || "",
            email: d.email || "",
            uid: d.id_number || "",  // Using id_number as uid
            id_db: d.id || ""  // Database ID from splexxo
          }));
          
          // ✅ Aadhaar IDs extract karo (id_number field se)
          const allIds = apiData.result.map(d => d.id_number).filter(Boolean);
          idsToProcess = uniqStrings(allIds);
        }
      } else {
        // Debugging ke liye
        console.log("Splexxo API Response:", rNumberInfo);
      }
    }

    // 🔄 STEP 2: Add manual Aadhaar input
    if (aadhaarInput) {
      idsToProcess = uniqStrings([...idsToProcess, aadhaarInput]);
    }

    if (!idsToProcess.length && !resultData.number_info.length) {
      return res.status(200).json({
        success: false,
        message: "कोई डेटा नहीं मिला।",
        data: resultData
      });
    }

    // 🔄 STEP 3: Ration और Aadhar APIs call करें (only if we have IDs)
    if (idsToProcess.length > 0) {
      for (const idVal of idsToProcess) {
        const rationUrl = `https://happy-ration-info.vercel.app/fetch?key=${encodeURIComponent(RATION_KEY)}&aadhaar=${encodeURIComponent(idVal)}`;
        const allApiUrl = `https://allapiinone.vercel.app/?key=${encodeURIComponent(ALLAPI_KEY)}&type=id_number&term=${encodeURIComponent(idVal)}`;

        const [rRation, rAll] = await Promise.all([
          fetchWithTimeout(rationUrl),
          fetchWithTimeout(allApiUrl)
        ]);

        if (rRation.ok && rRation.data) {
          resultData.ration.push({ id: idVal, data: rRation.data });
        }
        if (rAll.ok && rAll.data) {
          resultData.aadhar.push({ id: idVal, data: rAll.data });
        }
      }
    }

    // 🔄 STEP 4: Final Response
    const anyGood =
      resultData.number_info.length > 0 ||
      resultData.ration.length > 0 ||
      resultData.aadhar.length > 0;

    return res.status(200).json({
      success: Boolean(anyGood),
      message: anyGood
        ? "सभी APIs से डेटा प्राप्त हुआ।"
        : "कोई डेटा नहीं मिला।",
      data: resultData,
      developer: "Happy 😊"
    });

  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Server error: " + e.message
    });
  }
}
