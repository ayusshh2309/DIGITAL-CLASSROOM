(() => {
  const MAX_SIZE = 5 * 1024 * 1024;
  const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
  let selectedProfilePhoto = null;
  let previewUrl = "";

  function addStyles() {
    if (document.getElementById("profilePhotoPickerStyles")) return;
    const style = document.createElement("style");
    style.id = "profilePhotoPickerStyles";
    style.textContent = `
      .profile-photo-picker { display: block; width: 100%; min-width: 0; min-height: 150px; box-sizing: border-box; padding: 18px; border: 1px solid #e2e8f0; border-radius: 14px; container-type: inline-size; }
      .profile-photo-content { display: grid; grid-template-columns: 100px minmax(160px, 1fr) minmax(0, 340px); align-items: center; gap: 16px 20px; width: 100%; min-width: 0; box-sizing: border-box; }
      .profile-photo-info { width: 100%; min-width: 0; writing-mode: horizontal-tb; word-break: normal; overflow-wrap: break-word; white-space: normal; }
      .profile-photo-info h4, .profile-photo-info p { writing-mode: horizontal-tb; word-break: normal; overflow-wrap: break-word; white-space: normal; }
      .profile-photo-info h4 { margin: 0 0 6px; color: #172554; font-size: 1rem; font-weight: 750; }
      .profile-photo-preview { width: 100px; height: 100px; min-width: 100px; min-height: 100px; box-sizing: border-box; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: #f1f5f9; border: 1px solid #dbe3ee; color: #64748b; font-size: 2rem; }
      .profile-photo-preview img:not([hidden]) { display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; }
      .profile-photo-preview [hidden] { display: none !important; }
      .profile-photo-preview.has-photo > :not(img) { display: none !important; }
      .profile-photo-preview.has-photo { border-radius: 14px; background: #fff; }
      .profile-photo-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 10px; min-width: 0; max-width: 100%; }
      .profile-photo-actions button { min-width: 140px; min-height: 56px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #6b55ff; border-radius: 12px; background: #fff; color: #5538ee; padding: 12px 14px; font: inherit; font-size: .95rem; font-weight: 700; white-space: nowrap; cursor: pointer; }
      .profile-photo-actions button:first-of-type { border-color: #5538ee; background: #5538ee; color: #fff; }
      .profile-photo-actions button:hover { border-color: #5538ee; color: #5538ee; }
      .profile-photo-actions button:first-of-type:hover { background: #4930dd; color: #fff; }
      .profile-photo-actions svg { width: 16px; height: 16px; margin-right: 6px; vertical-align: -3px; }
      .profile-photo-actions button[hidden], .profile-photo-preview img[hidden] { display: none; }
      .profile-photo-actions-divider { width: 1px; height: 54px; flex: 0 0 1px; background: #d7d9ed; }
      .profile-photo-instruction, .profile-photo-status { color: #64748b; font-size: .82rem; line-height: 1.45; }
      .profile-photo-error { color: #b42318; font-size: .84rem; }
      .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) { grid-template-columns: 100px minmax(160px, 1fr) minmax(0, 340px); column-gap: 18px; row-gap: 14px; }
      .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) .profile-photo-actions { grid-column: 3; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); justify-content: stretch; gap: 8px; width: 100%; }
      .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) .profile-photo-actions-divider { display: none; }
      .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) .profile-photo-actions button { width: 100%; min-width: 0; min-height: 48px; padding: 9px 8px; font-size: .82rem; }
      .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) .profile-photo-actions button svg { width: 17px; height: 17px; margin-right: 5px; }
      .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) #removeProfilePhotoButton { grid-column: 1 / -1; border-color: #e2e8f0; color: #64748b; background: #fff; box-shadow: none; }
      .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) #removeProfilePhotoButton:hover { border-color: #f0b4b4; color: #b42318; background: #fff8f8; }
      @container (max-width: 680px) {
        .profile-photo-content { grid-template-columns: 100px minmax(0, 1fr); }
        .profile-photo-actions { grid-column: 1 / -1; justify-content: flex-start; }
        .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) { grid-template-columns: 100px minmax(0, 1fr); }
        .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) .profile-photo-actions { grid-column: 1 / -1; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); }
        .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) #removeProfilePhotoButton { grid-column: auto; }
      }
      @container (max-width: 480px) {
        .profile-photo-picker { padding: 14px; }
        .profile-photo-content { grid-template-columns: minmax(0, 1fr); gap: 12px; }
        .profile-photo-preview { justify-self: center; }
        .profile-photo-info { text-align: center; }
        .profile-photo-actions { grid-column: 1; justify-content: center; }
        .profile-photo-actions button { min-width: 140px; min-height: 48px; }
        .profile-photo-actions-divider { display: none; }
        .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) { grid-template-columns: minmax(0, 1fr); }
        .profile-photo-content:has(#removeProfilePhotoButton:not([hidden])) .profile-photo-actions { grid-column: 1; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); }
      }
      .profile-camera-backdrop { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; padding: 18px; background: rgba(15, 23, 42, .65); }
      .profile-camera-dialog { width: min(100%, 520px); padding: 20px; border-radius: 16px; background: white; box-shadow: 0 24px 70px rgba(0,0,0,.25); }
      .profile-camera-dialog h2 { margin: 0 0 14px; color: #0f172a; font-family: inherit; font-size: 1.1rem; line-height: 1.3; font-weight: 700; }
      .profile-camera-frame { min-height: 200px; overflow: hidden; display: grid; place-items: center; border-radius: 12px; background: #0f172a; }
      .profile-camera-frame video, .profile-camera-frame img { display: block; width: 100%; max-height: 60vh; object-fit: contain; }
      .profile-camera-controls { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      .profile-camera-controls button { border: 1px solid #d0d5dd; border-radius: 8px; background: white; color: #344054; padding: 9px 14px; font: inherit; font-weight: 600; cursor: pointer; }
      .profile-camera-controls .profile-camera-primary { border-color: #5538ee; background: #5538ee; color: white; }
      @media (max-width: 480px) { .profile-photo-actions button { flex: 1 1 auto; } }
    `;
    document.head.appendChild(style);
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
      reader.addEventListener("error", () => reject(reader.error || new Error("Could not read the selected photo.")), { once: true });
      reader.readAsDataURL(file);
    });
  }

  function fileFromDataUrl(dataUrl, name, type) {
    return fetch(dataUrl)
      .then((response) => response.blob())
      .then((blob) => new File([blob], name || `profile-photo.${type.split("/")[1]}`, {
        type: blob.type || type,
        lastModified: Date.now(),
      }));
  }

  async function preparePhotoForDraft(file) {
    if (file.size <= 2.5 * 1024 * 1024) return file;
    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("The image could not be prepared for registration."));
        image.src = sourceUrl;
      });
      for (const [maxDimension, quality] of [[1400, 0.8], [1100, 0.7]]) {
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= 2.5 * 1024 * 1024) {
          const baseName = file.name.replace(/\.[^.]+$/, "") || "profile-photo";
          return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
        }
      }
      throw new Error("This photo could not be prepared to fit safely in your registration draft. Choose a smaller image.");
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  function init(options) {
    addStyles();
    const input = document.getElementById("profilePhotoInput");
    const uploadButton = document.getElementById("uploadProfilePhotoButton");
    const cameraButton = document.getElementById("takeProfilePhotoButton");
    const removeButton = document.getElementById("removeProfilePhotoButton");
    const preview = document.getElementById("profilePhotoPreview");
    const placeholder = document.getElementById("profilePhotoPlaceholder");
    const previewFrame = preview?.closest(".profile-photo-preview");
    const selectionTitle = document.getElementById("profilePhotoSelectionTitle");
    const error = document.getElementById("profilePhotoError");
    const status = document.getElementById("uploadText");

    if (![input, uploadButton, cameraButton, removeButton, preview, placeholder, previewFrame, error, status].every(Boolean)) {
      throw new Error("The profile photo picker elements are missing from this registration page.");
    }

    let activeStream = null;
    let cameraBackdrop = null;
    let video = null;
    let capturedImage = null;
    let cameraFeedback = null;
    let captureButton = null;
    let retakeButton = null;
    let useButton = null;
    let cameraRequest = 0;
    let selectionRequest = 0;
    let capturedPreviewUrl = "";
    let pendingSelection = Promise.resolve();

    function setError(message = "") {
      error.textContent = message;
      error.hidden = !message;
    }

    function stopCamera() {
      cameraRequest += 1;
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
        activeStream = null;
      }
      if (video) video.srcObject = null;
    }

    function closeCamera() {
      stopCamera();
      cameraBackdrop?.remove();
      if (capturedPreviewUrl) URL.revokeObjectURL(capturedPreviewUrl);
      capturedPreviewUrl = "";
      cameraBackdrop = null;
      video = null;
      capturedImage = null;
      cameraFeedback = null;
      captureButton = null;
      retakeButton = null;
      useButton = null;
    }

    function dispose() {
      selectionRequest += 1;
      closeCamera();
      selectedProfilePhoto = null;
      input.value = "";
      displayPreview("", "");
    }

    function displayPreview(dataUrl, name) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = "";
      if (dataUrl) {
        preview.src = dataUrl;
        preview.hidden = false;
        placeholder.hidden = true;
        previewFrame.classList.add("has-photo");
        if (selectionTitle) selectionTitle.textContent = "Photo selected";
        status.textContent = name ? `${name} is selected.` : "Profile photo selected.";
        removeButton.hidden = false;
      } else {
        preview.removeAttribute("src");
        preview.hidden = true;
        placeholder.hidden = false;
        previewFrame.classList.remove("has-photo");
        if (selectionTitle) selectionTitle.textContent = "No photo selected";
        status.textContent = options.showFormatHint === false
          ? ""
          : "JPG, JPEG, PNG, or WEBP (max. 5 MB).";
        removeButton.hidden = true;
      }
    }

    async function selectFile(file) {
      if (!file) return;
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      if (!TYPES.has(file.type) || !EXTENSIONS.has(extension)) {
        setError("Choose a JPG, JPEG, PNG, or WEBP image.");
        input.value = "";
        return;
      }
      if (file.size > MAX_SIZE) {
        setError("Profile photos must be 5 MB or smaller.");
        input.value = "";
        return;
      }

      setError();
      const requestId = ++selectionRequest;
      const previousFile = selectedProfilePhoto;
      const objectUrl = URL.createObjectURL(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = objectUrl;
      preview.src = objectUrl;
      preview.hidden = false;
      placeholder.hidden = true;
      previewFrame.classList.add("has-photo");
      removeButton.hidden = false;
      status.textContent = `${file.name} is selected.`;
      selectedProfilePhoto = file;
      pendingSelection = preparePhotoForDraft(file).then((preparedFile) => {
        if (requestId !== selectionRequest) return;
        selectedProfilePhoto = preparedFile;
        if (preparedFile !== file) {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          previewUrl = URL.createObjectURL(preparedFile);
          preview.src = previewUrl;
        }
        return readAsDataUrl(preparedFile).then((dataUrl) => {
          if (requestId !== selectionRequest) return;
          return options.onChange({ file: preparedFile, dataUrl, name: preparedFile.name });
        });
      }).catch((readError) => {
        if (requestId !== selectionRequest) throw readError;
        selectedProfilePhoto = previousFile;
        setError(readError.message || "The photo could not be read. Please choose another image.");
        console.error("Profile photo could not be read.", readError);
        throw readError;
      });
      try {
        await pendingSelection;
      } catch {
        if (requestId !== selectionRequest) return;
        input.value = "";
        if (previousFile) {
          preview.src = URL.createObjectURL(previousFile);
          previewUrl = preview.src;
          status.textContent = `${previousFile.name} is selected.`;
        } else {
          displayPreview("", "");
        }
      }
    }

    function cameraErrorMessage(cameraError) {
      if (cameraError?.name === "NotAllowedError" || cameraError?.name === "SecurityError") {
        return "Camera permission was denied. Allow camera access in your browser settings and try again.";
      }
      if (cameraError?.name === "NotFoundError" || cameraError?.name === "DevicesNotFoundError") {
        return "No camera is available on this device.";
      }
      if (cameraError?.name === "NotReadableError" || cameraError?.name === "TrackStartError") {
        return "The camera is currently unavailable. Close other apps using it and try again.";
      }
      return "The camera could not be started. Use HTTPS or localhost and check your browser permissions.";
    }

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        closeCamera();
        setError("Camera capture is not supported by this browser. You can upload a photo instead.");
        return;
      }
      const requestId = ++cameraRequest;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "user" } },
        });
        if (requestId !== cameraRequest || !cameraBackdrop?.isConnected) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        activeStream = stream;
        video.srcObject = stream;
        await video.play();
      } catch (cameraError) {
        if (requestId === cameraRequest) {
          closeCamera();
          setError(cameraErrorMessage(cameraError));
        }
      }
    }

    function openCamera() {
      setError();
      cameraBackdrop = document.createElement("div");
      cameraBackdrop.className = "profile-camera-backdrop";
      cameraBackdrop.innerHTML = `
        <section class="profile-camera-dialog" role="dialog" aria-modal="true" aria-labelledby="profileCameraTitle">
          <h2 id="profileCameraTitle">Take a profile photo</h2>
          <div class="profile-camera-frame">
            <video autoplay muted playsinline aria-label="Live camera preview"></video>
            <img alt="Captured profile photo preview" hidden>
          </div>
          <p class="profile-photo-error" data-camera-error role="alert" hidden></p>
          <div class="profile-camera-controls">
            <button type="button" data-camera-cancel>Cancel</button>
            <button type="button" data-camera-retake hidden>Retake</button>
            <button type="button" class="profile-camera-primary" data-camera-capture>Capture</button>
            <button type="button" class="profile-camera-primary" data-camera-use hidden>Use Photo</button>
          </div>
        </section>`;
      document.body.appendChild(cameraBackdrop);
      video = cameraBackdrop.querySelector("video");
      capturedImage = cameraBackdrop.querySelector("img");
      cameraFeedback = cameraBackdrop.querySelector("[data-camera-error]");
      captureButton = cameraBackdrop.querySelector("[data-camera-capture]");
      retakeButton = cameraBackdrop.querySelector("[data-camera-retake]");
      useButton = cameraBackdrop.querySelector("[data-camera-use]");

      cameraBackdrop.querySelector("[data-camera-cancel]").addEventListener("click", closeCamera);
      cameraBackdrop.addEventListener("click", (event) => {
        if (event.target === cameraBackdrop) closeCamera();
      });
      cameraBackdrop.querySelector("[data-camera-capture]").addEventListener("click", () => {
        if (!video.videoWidth || !video.videoHeight) {
          cameraFeedback.textContent = "The camera is not ready yet. Please wait a moment and try again.";
          cameraFeedback.hidden = false;
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context || typeof canvas.toBlob !== "function") {
          cameraFeedback.textContent = "Photo capture is not supported by this browser.";
          cameraFeedback.hidden = false;
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!cameraBackdrop?.isConnected) return;
          if (!blob) {
            cameraFeedback.textContent = "The photo could not be captured. Please try again.";
            cameraFeedback.hidden = false;
            return;
          }
          const file = new File([blob], `profile-photo-${Date.now()}.jpg`, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
          if (capturedPreviewUrl) URL.revokeObjectURL(capturedPreviewUrl);
          capturedPreviewUrl = URL.createObjectURL(file);
          capturedImage.src = capturedPreviewUrl;
          capturedImage.hidden = false;
          video.hidden = true;
          captureButton.hidden = true;
          retakeButton.hidden = false;
          useButton.hidden = false;
          cameraFeedback.hidden = true;
          stopCamera();
          useButton.onclick = () => {
            closeCamera();
            input.value = "";
            selectFile(file);
          };
          retakeButton.onclick = () => {
            capturedImage.removeAttribute("src");
            capturedImage.hidden = true;
            video.hidden = false;
            captureButton.hidden = false;
            retakeButton.hidden = true;
            useButton.hidden = true;
            startCamera();
          };
        }, "image/jpeg", 0.92);
      });
      startCamera();
    }

    uploadButton.addEventListener("click", () => input.click());
    input.addEventListener("change", () => selectFile(input.files?.[0]));
    cameraButton.addEventListener("click", openCamera);
    removeButton.addEventListener("click", () => {
      selectionRequest += 1;
      selectedProfilePhoto = null;
      input.value = "";
      setError();
      displayPreview("", "");
      pendingSelection = Promise.resolve().then(() => options.onChange({ file: null, dataUrl: "", name: "" }));
    });
    window.addEventListener("pagehide", dispose, { once: true });

    const initialData = options.initialData;
    const ready = initialData
      ? fileFromDataUrl(initialData, options.initialName || "profile-photo.jpg", options.initialType || "image/jpeg")
        .then((file) => {
          selectedProfilePhoto = file;
          displayPreview(initialData, options.initialName || file.name);
          return options.onChange({ file, dataUrl: initialData, name: options.initialName || file.name, restoring: true });
        })
        .catch((restoreError) => {
          setError("The saved photo could not be restored. Please upload it again.");
          console.error("Saved registration photo could not be restored.", restoreError);
        })
      : Promise.resolve().then(() => {
          selectedProfilePhoto = null;
          displayPreview("", "");
          return options.onChange({ file: null, dataUrl: "", name: "" });
        });

    return {
      ready,
      getSelectedFile: () => selectedProfilePhoto,
      whenReady: () => Promise.all([ready, pendingSelection]),
    };
  }

  window.ProfilePhotoPicker = { init };
})();
