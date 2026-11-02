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
      .profile-photo-picker { display: grid; gap: 12px; }
      .profile-photo-preview { width: 112px; height: 112px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: #f1f5f9; border: 1px solid #dbe3ee; color: #64748b; font-size: 2rem; }
      .profile-photo-preview img { width: 100%; height: 100%; object-fit: cover; }
      .profile-photo-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .profile-photo-actions button { border: 1px solid #d0d5dd; border-radius: 8px; background: #fff; color: #344054; padding: 9px 13px; font: inherit; font-size: .85rem; font-weight: 600; cursor: pointer; }
      .profile-photo-actions button:hover { border-color: #5538ee; color: #5538ee; }
      .profile-photo-actions svg { width: 16px; height: 16px; margin-right: 6px; vertical-align: -3px; }
      .profile-photo-actions button[hidden], .profile-photo-preview img[hidden] { display: none; }
      .profile-photo-instruction, .profile-photo-status { color: #64748b; font-size: .82rem; line-height: 1.45; }
      .profile-photo-error { color: #b42318; font-size: .84rem; }
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
    const error = document.getElementById("profilePhotoError");
    const status = document.getElementById("uploadText");

    if (![input, uploadButton, cameraButton, removeButton, preview, placeholder, error, status].every(Boolean)) {
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

    function displayPreview(dataUrl, name) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = "";
      if (dataUrl) {
        preview.src = dataUrl;
        preview.hidden = false;
        placeholder.hidden = true;
        status.textContent = name ? `${name} is selected.` : "Profile photo selected.";
        removeButton.hidden = false;
      } else {
        preview.removeAttribute("src");
        preview.hidden = true;
        placeholder.hidden = false;
        status.textContent = "JPG, JPEG, PNG, or WEBP (max. 5 MB).";
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
