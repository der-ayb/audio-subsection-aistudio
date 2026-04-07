let db = null;
const DB_NAME = "quran_audio_cache";
const DB_VERSION = 2; // Incremented version to handle schema change (readerId in ayahId)
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay

// Helper to get current reader's base URL
function getBaseUrl() {
  return elements.readerName
    ? elements.readerName.value
    : "https://raw.githubusercontent.com/brmhmh/yacineee/refs/heads/upup/";
}

// Helper to get reader ID from URL
function getReaderId() {
  const url = getBaseUrl();
  if (url.includes("yacineee")) return "yacine";
  if (url.includes("ibraheem-aldosry")) return "ibraheem";
  if (url.includes("alhosary-warsh")) return "alhosary";
  return "default";
}

// Helper for fetching with retry and timeout
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  const timeout = options.timeout || 15000; // Default 15s timeout
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);

    if (!response.ok) {
      if (response.status >= 500 && retries > 0) {
        console.warn(
          `Server error ${response.status}, retrying... (${retries} left)`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY * (MAX_RETRIES - retries + 1)),
        );
        return fetchWithRetry(url, options, retries - 1);
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response;
  } catch (error) {
    clearTimeout(id);
    if (
      retries > 0 &&
      (error.name === "AbortError" || error.name === "TypeError")
    ) {
      console.warn(
        `Network error or timeout: ${error.message}, retrying... (${retries} left)`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY * (MAX_RETRIES - retries + 1)),
      );
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

const elements = {
  startSurahSelect: document.getElementById("startSurahSelect"),
  endSurahSelect: document.getElementById("endSurahSelect"),
  startAyaSelect: document.getElementById("startAyaSelect"),
  endAyaSelect: document.getElementById("endAyaSelect"),
  downloadBtn: document.getElementById("downloadBtn"),
  statusAlert: document.getElementById("statusAlert"),
  infoBox: document.getElementById("infoBox"),
  previewAudio: document.getElementById("preview"),
  downloadOfflineBtn: document.getElementById("downloadOfflineBtn"),
  downloadProgress: document.getElementById("downloadProgress"),
  progressBar: document.getElementById("progressBar"),
  storedCount: document.getElementById("storedCount"),
  surahCheckboxes: document.getElementById("surahCheckboxes"),
  onlineIndicator: document.getElementById("onlineIndicator"),
  readerName: document.getElementById("readerName"),
  speedControl: document.getElementById("speedControl"),
  speedBtns: document.querySelectorAll(".speed-btn"),
  selectAllBtn: document.getElementById("selectAllBtn"),
  deselectAllBtn: document.getElementById("deselectAllBtn"),
  clearAllBtn: document.getElementById("clearAllBtn"),
};

// Online/Offline Detection
function updateOnlineStatus() {
  const isOnline = navigator.onLine;
  if (elements.onlineIndicator) {
    elements.onlineIndicator.className = `online-indicator ${isOnline ? "online" : "offline"}`;
    elements.onlineIndicator.innerHTML = isOnline
      ? '<i class="bi bi-wifi"></i> متصل بالإنترنت'
      : '<i class="bi bi-wifi-off"></i> غير متصل';
  }
}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// IndexedDB functions
let dbInstance = null;

async function openDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error("IndexedDB open error:", event.target.error);
        reject(
          new Error(
            "فشل فتح قاعدة البيانات المحلية: " + event.target.error.message,
          ),
        );
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        dbInstance.onversionchange = () => {
          dbInstance.close();
          dbInstance = null;
          console.warn("Database version changed, closing connection.");
        };
        resolve(dbInstance);
      };

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("ayahs")) {
          db.createObjectStore("ayahs", { keyPath: "ayahId" });
        }
      };

      request.onblocked = () => {
        console.warn("IndexedDB open blocked. Please close other tabs.");
        reject(new Error("قاعدة البيانات مشغولة في تبويب آخر."));
      };
    } catch (e) {
      reject(e);
    }
  });
}

async function saveAyahToCache(surah, ayah, arrayBuffer) {
  try {
    const db = await openDB();
    const readerId = getReaderId();
    const ayahId = `${readerId}_${String(surah).padStart(3, "0")}${String(ayah).padStart(3, "0")}`;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["ayahs"], "readwrite");
      const store = transaction.objectStore("ayahs");

      transaction.oncomplete = () => resolve();
      transaction.onerror = (event) => {
        console.error("Transaction error:", event.target.error);
        reject(new Error("فشل حفظ الآية في الذاكرة المؤقتة."));
      };
      transaction.onabort = () => reject(new Error("تم إلغاء عملية الحفظ."));

      store.put({ ayahId, readerId, surah, ayah, data: arrayBuffer });
    });
  } catch (error) {
    console.error("saveAyahToCache error:", error);
    throw error;
  }
}

async function getAyahFromCache(surah, ayah) {
  try {
    const db = await openDB();
    const readerId = getReaderId();
    const ayahId = `${readerId}_${String(surah).padStart(3, "0")}${String(ayah).padStart(3, "0")}`;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["ayahs"], "readonly");
      const store = transaction.objectStore("ayahs");
      const request = store.get(ayahId);

      request.onsuccess = () => resolve(request.result?.data || null);
      request.onerror = (event) => {
        console.error("Get ayah error:", event.target.error);
        reject(new Error("فشل قراءة الآية من الذاكرة المؤقتة."));
      };
      transaction.onerror = (event) => reject(event.target.error);
    });
  } catch (error) {
    console.warn("getAyahFromCache failed, falling back to network:", error);
    return null;
  }
}

async function getStoredSurahs() {
  try {
    const db = await openDB();
    const readerId = getReaderId();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["ayahs"], "readonly");
      const store = transaction.objectStore("ayahs");
      const request = store.getAll();

      request.onsuccess = () => {
        const ayahs = request.result.filter((a) => a.readerId === readerId);
        const surahs = [...new Set(ayahs.map((a) => a.surah))];
        resolve(surahs);
      };
      request.onerror = (event) => reject(event.target.error);
      transaction.onerror = (event) => reject(event.target.error);
    });
  } catch (error) {
    console.error("getStoredSurahs error:", error);
    return [];
  }
}

async function clearAllCache() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["ayahs"], "readwrite");
      const store = transaction.objectStore("ayahs");
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
      transaction.onerror = (event) => reject(event.target.error);
    });
  } catch (error) {
    console.error("clearAllCache error:", error);
    throw error;
  }
}

async function updateStoredSurahsList() {
  const stored = await getStoredSurahs();
  if (elements.storedCount) elements.storedCount.textContent = stored.length;

  const checkboxes = elements.surahCheckboxes.querySelectorAll(
    'input[type="checkbox"]',
  );
  checkboxes.forEach((cb) => {
    const surahNum = parseInt(cb.value);
    const container = cb.closest(".surah-checkbox");
    if (stored.includes(surahNum)) {
      cb.checked = true;
      if (container) {
        container.classList.add("downloaded");
        // Add play button if not already there
        if (!container.querySelector(".play-surah-btn")) {
          const playBtn = document.createElement("button");
          playBtn.className = "btn btn-sm btn-link play-surah-btn p-0 ms-2";
          playBtn.innerHTML =
            '<i class="bi bi-play-fill text-success fs-4"></i>';
          playBtn.title = "تشغيل السورة كاملة";
          playBtn.onclick = (e) => {
            e.preventDefault();
            playStoredSurah(surahNum);
          };
          container.appendChild(playBtn);
        }
      }
    } else {
      cb.checked = false;
      if (container) {
        container.classList.remove("downloaded");
        const playBtn = container.querySelector(".play-surah-btn");
        if (playBtn) playBtn.remove();
      }
    }
  });
}

async function playStoredSurah(surahNum) {
  try {
    elements.startSurahSelect.value = surahNum;
    elements.endSurahSelect.value = surahNum;
    await loadAyasForStartSurah();
    await loadAyasForEndSurah();

    // Select all ayahs in this surah
    const result = db.exec(
      `SELECT num_ayat FROM quran_index WHERE id_sura = ${surahNum}`,
    );
    if (result.length > 0) {
      const numAyat = result[0].values[0][0];
      elements.startAyaSelect.value = "1";
      elements.endAyaSelect.value = numAyat;

      // Trigger download/merge and play (without downloading file)
      await downloadAudioSegment(false);
    }
  } catch (error) {
    showStatus(`خطأ في تشغيل السورة: ${error.message}`, "danger");
  }
}

function showStatus(message, type = "info") {
  const alertClass = `alert-${type}`;
  if (elements.statusAlert) {
    elements.statusAlert.className = `alert ${alertClass} mt-3`;
    elements.statusAlert.innerHTML = `<i class="bi bi-${
      type === "success"
        ? "check-circle"
        : type === "danger"
          ? "x-circle"
          : "info-circle"
    }"></i> ${message}`;
    elements.statusAlert.classList.remove("d-none");
  }
}

function showInfo(message) {
  if (elements.infoBox) {
    elements.infoBox.innerHTML = `<i class="bi bi-info-circle"></i> ${message}`;
    elements.infoBox.classList.remove("d-none");
  }
}

// URL Parameter Handling
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    ss: params.get("ss"), // Start Surah
    sa: params.get("sa"), // Start Ayah
    es: params.get("es"), // End Surah
    ea: params.get("ea"), // End Ayah
    r: params.get("r"), // Reader index
    sp: params.get("sp"), // Speed
  };
}

function updateUrlParams() {
  const params = new URLSearchParams();
  if (elements.startSurahSelect.value)
    params.set("ss", elements.startSurahSelect.value);
  if (elements.startAyaSelect.value)
    params.set("sa", elements.startAyaSelect.value);
  if (elements.endSurahSelect.value)
    params.set("es", elements.endSurahSelect.value);
  if (elements.endAyaSelect.value)
    params.set("ea", elements.endAyaSelect.value);
  if (elements.readerName.selectedIndex !== -1)
    params.set("r", elements.readerName.selectedIndex);

  const activeSpeedBtn = document.querySelector(".speed-btn.active");
  if (activeSpeedBtn) params.set("sp", activeSpeedBtn.dataset.speed);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", newUrl);
}

async function applyUrlParams() {
  const params = getUrlParams();

  // Load reader from URL or localStorage
  if (params.r !== null) {
    elements.readerName.selectedIndex = parseInt(params.r);
    localStorage.setItem("selectedReaderIndex", params.r);
    updateStoredSurahsList();
  } else {
    const savedReaderIndex = localStorage.getItem("selectedReaderIndex");
    if (savedReaderIndex !== null) {
      elements.readerName.selectedIndex = parseInt(savedReaderIndex);
      updateStoredSurahsList();
    }
  }

  if (params.sp !== null) {
    const speedBtn = Array.from(elements.speedBtns).find(
      (btn) => btn.dataset.speed === params.sp,
    );
    if (speedBtn) {
      elements.speedBtns.forEach((b) => b.classList.remove("active"));
      speedBtn.classList.add("active");
    }
  }

  if (params.ss !== null) {
    elements.startSurahSelect.value = params.ss;
    await loadAyasForStartSurah();

    if (params.sa !== null) {
      elements.startAyaSelect.value = params.sa;
      await loadAyasForEndSurah(); // This also updates end surah options
    }
  }

  if (params.es !== null) {
    elements.endSurahSelect.value = params.es;
    await loadAyasForEndSurah();

    if (params.ea !== null) {
      elements.endAyaSelect.value = params.ea;
    }
  }
}

async function initDatabase() {
  try {
    showStatus("جاري تحميل قاعدة البيانات...", "info");
    const SQL = await initSqlJs({
      locateFile: (file) =>
        `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`,
    });

    const response = await fetchWithRetry("./assets/quran.sqlite");
    if (!response.ok) throw new Error("فشل تحميل ملف قاعدة البيانات");
    const buffer = await response.arrayBuffer();
    db = new SQL.Database(new Uint8Array(buffer));

    loadSurahs();
    await applyUrlParams();
    await updateStoredSurahsList();

    showStatus("تم تحميل قاعدة البيانات بنجاح!", "success");
  } catch (error) {
    showStatus(`خطأ في تحميل قاعدة البيانات: ${error.message}`, "danger");
  }
}

function loadSurahs() {
  if (!db) return;
  const result = db.exec(
    "SELECT id_sura, sura, num_ayat FROM quran_index ORDER BY id_sura",
  );

  if (result.length > 0) {
    elements.startSurahSelect.innerHTML = "";
    elements.endSurahSelect.innerHTML = "";
    elements.surahCheckboxes.innerHTML = "";
    const rows = result[0].values;

    rows.forEach((row) => {
      const [id_sura, sura, num_ayat] = row;

      const option = document.createElement("option");
      option.value = id_sura;
      option.textContent = `${id_sura}. ${sura}`;
      option.dataset.numAyat = num_ayat;

      elements.startSurahSelect.appendChild(option.cloneNode(true));
      elements.endSurahSelect.appendChild(option.cloneNode(true));

      const checkboxDiv = document.createElement("div");
      checkboxDiv.className = "surah-checkbox form-check";
      checkboxDiv.innerHTML = `
        <input type="checkbox" class="form-check-input" id="surah_${id_sura}" value="${id_sura}">
        <label class="form-check-label w-100" for="surah_${id_sura}">
          ${id_sura}. ${sura}
        </label>
      `;
      elements.surahCheckboxes.appendChild(checkboxDiv);
    });

    elements.startSurahSelect.value = "1";
    elements.endSurahSelect.value = "1";
    loadAyasForStartSurah();
    loadAyasForEndSurah();
  }
}

async function loadAyasForStartSurah() {
  const surahId = parseInt(elements.startSurahSelect.value);
  if (!surahId || !db) return;

  const result = db.exec(
    `SELECT ayah, text FROM quran_ayat WHERE sura = ${surahId} ORDER BY ayah`,
  );

  if (result.length > 0) {
    elements.startAyaSelect.innerHTML = "";
    const rows = result[0].values;

    rows.forEach((row) => {
      const [ayah, text] = row;
      const option = document.createElement("option");
      option.value = ayah;
      option.textContent = `${ayah}. ${text}`;
      elements.startAyaSelect.appendChild(option);
    });

    elements.startAyaSelect.value = "1";
    updateEndSurahOptions();
  }
}

function updateEndSurahOptions() {
  const startSurah = parseInt(elements.startSurahSelect.value);
  const currentEndSurah = parseInt(elements.endSurahSelect.value);

  // Disable surahs before startSurah in endSurahSelect
  Array.from(elements.endSurahSelect.options).forEach((option) => {
    const surahId = parseInt(option.value);
    option.hidden = surahId < startSurah;
  });

  if (currentEndSurah < startSurah) {
    elements.endSurahSelect.value = startSurah;
    loadAyasForEndSurah();
  }
}

async function loadAyasForEndSurah() {
  const startSurah = parseInt(elements.startSurahSelect.value);
  const endSurah = parseInt(elements.endSurahSelect.value);
  const startAya = parseInt(elements.startAyaSelect.value);

  if (!endSurah || !db) return;

  const result = db.exec(
    `SELECT ayah, text FROM quran_ayat WHERE sura = ${endSurah} ORDER BY ayah`,
  );

  if (result.length > 0) {
    elements.endAyaSelect.innerHTML = "";
    const rows = result[0].values;

    rows.forEach((row) => {
      const [ayah, text] = row;
      const option = document.createElement("option");
      option.value = ayah;
      option.textContent = `${ayah}. ${text}`;

      // If same surah, disable ayas before startAya
      if (startSurah === endSurah && ayah < startAya) {
        option.hidden = true;
      }

      elements.endAyaSelect.appendChild(option);
    });

    // Set default end aya
    if (startSurah === endSurah) {
      if (parseInt(elements.endAyaSelect.value) < startAya) {
        elements.endAyaSelect.value = startAya;
      }
    } else {
      // Default to last aya of end surah if it's a different surah?
      // Or just keep current if valid.
    }

    elements.downloadBtn.disabled = false;
  }
}

elements.selectAllBtn.addEventListener("click", () => {
  const checkboxes = elements.surahCheckboxes.querySelectorAll(
    'input[type="checkbox"]',
  );
  checkboxes.forEach((cb) => (cb.checked = true));
});

elements.deselectAllBtn.addEventListener("click", () => {
  const checkboxes = elements.surahCheckboxes.querySelectorAll(
    'input[type="checkbox"]',
  );
  checkboxes.forEach((cb) => (cb.checked = false));
});

elements.clearAllBtn.addEventListener("click", async () => {
  if (!confirm("هل أنت متأكد من حذف جميع السور المحفوظة؟")) return;
  try {
    await clearAllCache();
    await updateStoredSurahsList();
    showStatus("تم حذف جميع السور المحفوظة", "success");
  } catch (error) {
    showStatus(`خطأ في الحذف: ${error.message}`, "danger");
  }
});

elements.downloadOfflineBtn.addEventListener("click", async () => {
  if (!navigator.onLine) {
    showStatus("يجب الاتصال بالإنترنت لتحميل السور", "danger");
    return;
  }

  const checkboxes = elements.surahCheckboxes.querySelectorAll(
    'input[type="checkbox"]:checked',
  );
  const selectedSurahs = Array.from(checkboxes).map((cb) => parseInt(cb.value));

  if (selectedSurahs.length === 0) {
    showStatus("الرجاء اختيار سورة واحدة على الأقل", "danger");
    return;
  }

  elements.downloadOfflineBtn.disabled = true;
  elements.downloadProgress.classList.remove("d-none");

  let totalAyahs = 0;
  let downloadedAyahs = 0;

  for (const surahNum of selectedSurahs) {
    const result = db.exec(
      `SELECT num_ayat FROM quran_index WHERE id_sura = ${surahNum}`,
    );
    if (result.length > 0) {
      totalAyahs += result[0].values[0][0];
    }
  }

  for (const surahNum of selectedSurahs) {
    const result = db.exec(
      `SELECT num_ayat FROM quran_index WHERE id_sura = ${surahNum}`,
    );
    if (result.length > 0) {
      const numAyat = result[0].values[0][0];

      for (let ayah = 1; ayah <= numAyat; ayah++) {
        try {
          const ayahId = `${String(surahNum).padStart(3, "0")}${String(ayah).padStart(3, "0")}`;
          const audioUrl = `${getBaseUrl()}${ayahId}.mp3`;

          const response = await fetchWithRetry(audioUrl);
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            await saveAyahToCache(surahNum, ayah, arrayBuffer);
          }

          downloadedAyahs++;
          const progress = Math.round((downloadedAyahs / totalAyahs) * 100);
          elements.progressBar.style.width = progress + "%";
          elements.progressBar.textContent = `${progress}% - آية ${ayah}/${numAyat} من السورة ${surahNum}`;
        } catch (error) {
          console.error(
            `خطأ في تحميل الآية ${ayah} من السورة ${surahNum}:`,
            error,
          );
        }
      }
    }
  }

  elements.progressBar.style.width = "100%";
  elements.progressBar.textContent = "اكتمل التحميل!";
  await updateStoredSurahsList();

  setTimeout(() => {
    elements.downloadProgress.classList.add("d-none");
    elements.downloadOfflineBtn.disabled = false;
    showStatus("تم حفظ السور بنجاح!", "success");
  }, 1500);
});

async function downloadAudioSegment(triggerDownload = true) {
  const startSurah = parseInt(elements.startSurahSelect.value);
  const endSurah = parseInt(elements.endSurahSelect.value);
  const startAya = parseInt(elements.startAyaSelect.value);
  const endAya = parseInt(elements.endAyaSelect.value);

  if (!startSurah || !endSurah || !startAya || !endAya) {
    showStatus("الرجاء اختيار جميع الحقول", "danger");
    return;
  }

  try {
    elements.downloadBtn.disabled = true;
    elements.previewAudio.classList.add("d-none");
    elements.infoBox.classList.add("d-none");

    const audioBuffers = [];
    const audioContext = new (
      window.AudioContext || window.webkitAudioContext
    )();

    // Collect all ayahs across surahs
    const ayahsToFetch = [];
    for (let s = startSurah; s <= endSurah; s++) {
      const sStart = s === startSurah ? startAya : 1;
      let sEnd;
      if (s === endSurah) {
        sEnd = endAya;
      } else {
        const result = db.exec(
          `SELECT num_ayat FROM quran_index WHERE id_sura = ${s}`,
        );
        sEnd = result[0].values[0][0];
      }

      for (let a = sStart; a <= sEnd; a++) {
        ayahsToFetch.push({ surah: s, ayah: a });
      }
    }

    const ayahCount = ayahsToFetch.length;
    showInfo(`جاري تحميل ${ayahCount} آية...`);
    showStatus("جاري تحميل الآيات...", "info");

    for (const item of ayahsToFetch) {
      const { surah, ayah } = item;
      showStatus(`جاري معالجة الآية ${ayah} من ${ayahCount}...`, "info");
      let arrayBuffer = await getAyahFromCache(surah, ayah);

      if (!arrayBuffer) {
        if (!navigator.onLine) {
          showStatus(
            `لا يوجد اتصال بالإنترنت والآية ${ayah} من السورة ${surah} غير محفوظة`,
            "danger",
          );
          elements.downloadBtn.disabled = false;
          return;
        }

        const ayahId = `${String(surah).padStart(3, "0")}${String(ayah).padStart(3, "0")}`;
        const audioUrl = `${getBaseUrl()}${ayahId}.mp3`;

        const response = await fetchWithRetry(audioUrl);
        if (!response.ok)
          throw new Error(`فشل تحميل الآية ${ayah} من السورة ${surah}`);
        arrayBuffer = await response.arrayBuffer();
      }

      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      audioBuffers.push(audioBuffer);
    }

    showStatus("جاري دمج الآيات...", "info");
    const currentSpeed = parseFloat(
      document.querySelector(".speed-btn.active")?.dataset.speed || "1",
    );
    const mergedBuffer = await mergeAudioBuffers(
      audioContext,
      audioBuffers,
      currentSpeed,
    );
    showStatus("جاري ترميز الصوت...", "info");
    const wavBlob = bufferToWave(mergedBuffer);

    const previewUrl = URL.createObjectURL(wavBlob);

    elements.previewAudio.src = previewUrl;
    elements.previewAudio.classList.remove("d-none");

    // Apply current speed to the native element for UI consistency
    elements.previewAudio.playbackRate = 1; // Speed is already baked into the wavBlob!

    if (triggerDownload) {
      const a = document.createElement("a");
      a.href = previewUrl;
      a.download = `quran.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showStatus("اكتمل التحميل! المعاينة متاحة أدناه.", "success");
    } else {
      showStatus("تم التجهيز! يمكنك الاستماع الآن.", "success");
      elements.previewAudio.play();
    }

    showInfo(`تم دمج ${ayahCount} آية بنجاح`);
  } catch (error) {
    showStatus(`خطأ: ${error.message}`, "danger");
    console.error(error);
  } finally {
    elements.downloadBtn.disabled = false;
  }
}

async function mergeAudioBuffers(audioContext, buffers, speed = 1) {
  if (buffers.length === 0) throw new Error("لا توجد ملفات صوتية للدمج");

  const numberOfChannels = buffers[0].numberOfChannels;
  const sampleRate = buffers[0].sampleRate;

  // Calculate total samples at 1x speed
  let totalLengthSamples = 0;
  buffers.forEach((b) => (totalLengthSamples += b.length));

  // Create the 1x merged buffer
  const mergedBuffer = audioContext.createBuffer(
    numberOfChannels,
    totalLengthSamples,
    sampleRate,
  );

  let offset = 0;
  buffers.forEach((buffer) => {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sourceData = buffer.getChannelData(channel);
      const targetData = mergedBuffer.getChannelData(channel);
      targetData.set(sourceData, offset);
    }
    offset += buffer.length;
  });

  // If speed is 1, we are done
  if (speed === 1) {
    return mergedBuffer;
  }

  // Use Tone.Offline to apply speed to the TOTAL merged buffer
  const renderedDuration = totalLengthSamples / sampleRate / speed;
  return await Tone.Offline(
    () => {
      // GrainPlayer allows changing speed without changing pitch
      const player = new Tone.GrainPlayer(mergedBuffer).toDestination();

      // Apply speed (playbackRate)
      player.playbackRate = speed;

      // Ensure the grain size and overlap are suitable for speech
      player.grainSize = 0.25;
      player.overlap = 0.05;
      player.detune = 0

      player.start(0);
    },
    renderedDuration,
    numberOfChannels,
    sampleRate,
  );
}

function bufferToWave(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length * numChannels * 2;
  const buffer = new ArrayBuffer(44 + length);
  const view = new DataView(buffer);

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++)
      view.setUint8(offset + i, string.charCodeAt(i));
  };

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, length, true);

  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = Math.max(
        -1,
        Math.min(1, audioBuffer.getChannelData(channel)[i]),
      );
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

elements.startSurahSelect.addEventListener("change", () => {
  loadAyasForStartSurah();
  updateUrlParams();
});
elements.endSurahSelect.addEventListener("change", () => {
  loadAyasForEndSurah();
  updateUrlParams();
});
elements.readerName.addEventListener("change", () => {
  localStorage.setItem(
    "selectedReaderIndex",
    elements.readerName.selectedIndex,
  );
  updateStoredSurahsList();
  updateUrlParams();
});
elements.startAyaSelect.addEventListener("change", () => {
  loadAyasForEndSurah();
  updateUrlParams();
});
elements.endAyaSelect.addEventListener("change", updateUrlParams);
elements.downloadBtn.addEventListener("click", downloadAudioSegment);

// Speed control listeners
if (elements.speedBtns) {
  elements.speedBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const speed = parseFloat(btn.dataset.speed);

      // If we have a Howl playing, we might need to update its rate
      // But wait, our wavBlob ALREADY has the speed baked in!
      // So if the user changes the speed AFTER downloading,
      // we should probably re-download/re-merge to bake the new speed in,
      // OR we just update the playback rate of the current audio.

      if (elements.previewAudio) {
        // If speed is baked in, playbackRate should be 1.
        // If we want to change speed on the fly, we'd need to NOT bake it in.
        // But the user specifically wanted it baked in for the download.

        // For now, let's just update the UI and the native element's rate
        // to show the user the speed is changing.
        elements.previewAudio.playbackRate = 1; // Keep it at 1 because it's baked in!
      }

      // Update active state
      elements.speedBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      updateUrlParams();

      // Inform the user that they need to re-download to apply new speed to the file
      if (!elements.previewAudio.classList.contains("d-none")) {
        showInfo(
          "لتطبيق السرعة الجديدة على الملف المحمل، يرجى الضغط على 'تحميل المقطع' مرة أخرى.",
        );
      }
    });
  });
}

initDatabase();

// Global error handler for unhandled promise rejections
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  showStatus(
    "حدث خطأ غير متوقع: " + (event.reason?.message || "يرجى المحاولة مرة أخرى"),
    "danger",
  );
});
