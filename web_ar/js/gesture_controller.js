/**
 * ==============================================================================
 * VisionCraft Studio - Comprehensive AI Gesture & AR Try-On Spatial Engine
 * ==============================================================================
 * Features:
 * 1. Dual Drag & Drop: Hand Gesture Pinch/Drop + HTML5 Mouse Drag/Drop
 * 2. Exact Drop Coordinates Mapping to Image Canvas (Snap where you drop!)
 * 3. MediaPipe Hands 60 FPS Tracking with EMA Jitter Filter
 * 4. AR Virtual Try-On Studio (Sunglasses, Optical Glasses, Suits, Scarves, Hats)
 * 5. MediaPipe Face Mesh & Facial Interactions (Mouth Trigger, Eye Wink EAR, Nose Pointer)
 * 6. Guaranteed REST Execution & WebSocket Stream Synchronization
 * ==============================================================================
 */

class GestureController {
    constructor(appInstance) {
        this.app = appInstance;
        this.isEnabled = false;
        this.controlMode = "hand"; // "hand" or "nose" (Accessibility Mode)
        this.activeCategory = "ar"; // افتراضياً غرفة التجميل لتجربة مباشرة

        // MediaPipe Engines
        this.hands = null;
        this.faceMesh = null;
        this.camera = null;
        this.mediaStream = null;
        this.localLoopId = null;
        this.cameraSource = localStorage.getItem("visioncraft_cam_source") || "ipcam";
        this.ipCamUrl = localStorage.getItem("visioncraft_ipcam_url") || "http://192.168.8.106:8080/video";
        this.ipCamImg = null;
        this.ipCamLoopId = null;

        // Register globally
        window.gestureController = this;
        gestureController = this;

        // DOM Elements
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasCtx = null;
        this.cursorElement = null;
        this.ghostElement = null;
        this.pipContainer = null;
        this.feedbackBadge = null;
        this.statusDot = null;
        this.wsBadge = null;
        this.progressRingCircle = null;

        // WebSocket State
        this.socket = null;
        this.isWsConnected = false;

        // Coordinate Smoothing (Exponential Moving Average Filter)
        this.cursorX = window.innerWidth / 2;
        this.cursorY = window.innerHeight / 2;
        this.emaAlpha = 0.38;

        // Gesture Detection State Machines
        this.prevScissorsDist = null;
        this.isHoldingTool = false;
        this.activeToolData = null;
        this.hoveredCard = null;
        this.pinchHoldFrames = 0;

        // Velocity tracking for Swipe Left (Undo)
        this.prevWristX = null;
        this.prevWristTime = null;
        this.lastSwipeTime = 0;

        // Thumbs Up 1-Second Timer State (Save)
        this.thumbsUpStartTime = null;
        this.lastSaveTime = 0;

        // Face & Eye Wink Detection State
        this.latestFaceLandmarks = null;
        this.lastWinkTime = 0;
        this.lastMouthTime = 0;

        // Catalog of DIP Core Filters
        this.dipTools = [
            {
                id: "canny",
                title: "Canny Edge",
                sub: "حواف دقيقة فائقة",
                icon: "⚡",
                type: "dip",
                op: "canny",
                params: { t1: 50, t2: 150, sigma: 1.4 },
                headerTitle: "Canny Edge Detection"
            },
            {
                id: "gaussian",
                title: "Gaussian Blur",
                sub: "تنعيم وإزالة الضوضاء",
                icon: "💧",
                type: "dip",
                op: "gaussian",
                params: { ksize: 7, sigma: 1.8 },
                headerTitle: "Gaussian Spatial Blur Filter"
            },
            {
                id: "hist_eq",
                title: "Hist Equalize",
                sub: "موازنة وتوزيع التباين",
                icon: "📊",
                type: "dip",
                op: "histogram_equalization",
                params: { method: "global" },
                headerTitle: "Global Histogram Equalization"
            },
            {
                id: "laplacian",
                title: "Laplacian Sharpen",
                sub: "شحذ التفاصيل الهندسية",
                icon: "🗡️",
                type: "dip",
                op: "laplacian",
                params: { ksize: 3 },
                headerTitle: "Laplacian High-Pass Sharpening"
            },
            {
                id: "sobel",
                title: "Sobel Gradient",
                sub: "مشتقات الحواف الأفقية",
                icon: "📐",
                type: "dip",
                op: "sobel",
                params: { ksize: 3 },
                headerTitle: "Sobel Gradient Edge Operator"
            },
            {
                id: "dilation",
                title: "Morph Dilation",
                sub: "تمدد الأشكال وتوسيع الحواف",
                icon: "🔬",
                type: "dip",
                op: "dilation",
                params: { ksize: 5, shape: "rect", iterations: 1 },
                headerTitle: "Morphological Dilation"
            },
            {
                id: "negative",
                title: "Negative Invert",
                sub: "عكس درجات الألوان (سالب)",
                icon: "🌓",
                type: "dip",
                op: "negative",
                params: {},
                headerTitle: "Negative Color Inversion"
            },
            {
                id: "revert",
                title: "Revert Original",
                sub: "استرجاع الصورة الأصلية",
                icon: "🔄",
                type: "dip",
                op: "none",
                params: {},
                headerTitle: "Reverted to Original"
            }
        ];

        // Catalog of AR Virtual Try-On Accessories
        this.arTools = [
            {
                id: "glasses_black",
                title: "نظارة شمسية سوداء",
                sub: "Black Aviator Sunglasses",
                icon: "🕶️",
                type: "ar",
                accessory: "glasses_black",
                headerTitle: "AR Try-On: نظارة شمسية سوداء"
            },
            {
                id: "glasses_optical",
                title: "نظارة طبية ذهبية",
                sub: "Golden Optical Glasses",
                icon: "👓",
                type: "ar",
                accessory: "glasses_optical",
                headerTitle: "AR Try-On: نظارة طبية ذهبية كلاسيكية"
            },
            {
                id: "suit_formal",
                title: "بدلة رسمية فاخرة",
                sub: "Formal Suit & Red Tie",
                icon: "👔",
                type: "ar",
                accessory: "suit_formal",
                headerTitle: "AR Try-On: بدلة رسمية فاخرة وربطة عنق"
            },
            {
                id: "scarf_winter",
                title: "وشاح شتوي أنيق",
                sub: "Warm Winter Scarf",
                icon: "🧣",
                type: "ar",
                accessory: "scarf_winter",
                headerTitle: "AR Try-On: وشاح شتوي دافئ"
            },
            {
                id: "hat_fedora",
                title: "قبعة فيدورا كلاسيكية",
                sub: "Classic Fedora Hat",
                icon: "🎩",
                type: "ar",
                accessory: "hat_fedora",
                headerTitle: "AR Try-On: قبعة فيدورا كلاسيكية"
            }
        ];

        this.initDOM();
        this.bindCanvasDropEvents();
        this.initWebSocket();
        this.renderShelfItems();
        this.loadCatalogThings();
    }

    async loadCatalogThings() {
        try {
            const resp = await fetch("/api/catalog");
            if (!resp.ok) return;
            const data = await resp.json();
            if (!data) return;

            const newArTools = [];
            const categoryOrder = ["suite", "maried", "glasses", "cap", "hair", "wishah", "mask", "graduition"];

            categoryOrder.forEach(catKey => {
                const cat = data[catKey];
                if (cat && cat.items) {
                    cat.items.forEach(item => {
                        newArTools.push({
                            id: item.id,
                            title: item.title,
                            sub: cat.title,
                            icon: cat.icon,
                            type: "ar",
                            category: catKey,
                            accessory: item.id,
                            headerTitle: `AR Try-On: ${item.title}`
                        });
                    });
                }
            });

            if (newArTools.length > 0) {
                this.arTools = newArTools;
            }

            if (this.activeCategory === "ar") {
                this.renderShelfItems();
            }
        } catch (e) {
            console.warn("Could not load catalog things into shelf:", e);
        }
    }

    initDOM() {
        this.cursorElement = document.getElementById("handCursor");
        this.ghostElement = document.getElementById("handGrabGhost");
        this.pipContainer = document.getElementById("gesturePipContainer");
        this.videoElement = document.getElementById("gestureVideo");
        this.canvasElement = document.getElementById("gestureSkeletonCanvas");
        if (this.canvasElement) {
            this.canvasCtx = this.canvasElement.getContext("2d");
        }
        this.feedbackBadge = document.getElementById("pipFeedback");
        this.statusDot = document.getElementById("pipStatusDot");
        this.wsBadge = document.getElementById("pipWsBadge");
        
        const ring = document.getElementById("cursorProgressRing");
        if (ring) {
            this.progressRingCircle = ring.querySelector("circle");
        }
    }

    /**
     * ربط أحداث الإفلات المباشر على الكانفاس للفأرة (HTML5 Drag & Drop)
     */
    bindCanvasDropEvents() {
        const dropTargets = [this.app.viewport, this.app.docFrame, this.app.canvasRaw, this.app.canvasProcessed];

        dropTargets.forEach(el => {
            if (!el) return;

            el.addEventListener("dragover", (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                if (this.app.docFrame) this.app.docFrame.classList.add("doc-frame-drop-active");
            });

            el.addEventListener("dragleave", (e) => {
                if (this.app.docFrame) this.app.docFrame.classList.remove("doc-frame-drop-active");
            });

            el.addEventListener("drop", (e) => {
                e.preventDefault();
                if (this.app.docFrame) this.app.docFrame.classList.remove("doc-frame-drop-active");

                const rawData = e.dataTransfer.getData("application/json");
                if (!rawData) return;

                try {
                    const tool = JSON.parse(rawData);
                    const rect = this.app.canvasRaw.getBoundingClientRect();
                    let canvasX = Math.round((e.clientX - rect.left) * (this.app.canvasRaw.naturalWidth / rect.width));
                    let canvasY = Math.round((e.clientY - rect.top) * (this.app.canvasRaw.naturalHeight / rect.height));

                    canvasX = Math.max(0, Math.min(this.app.canvasRaw.naturalWidth, canvasX));
                    canvasY = Math.max(0, Math.min(this.app.canvasRaw.naturalHeight, canvasY));

                    this.createDropRipple(e.clientX, e.clientY);
                    this.executeTool(tool, { x: canvasX, y: canvasY });

                } catch (err) {
                    console.error("HTML5 Drop handling error:", err);
                }
            });
        });
    }

    initWebSocket() {
        try {
            if (typeof io !== "undefined") {
                this.socket = io(window.location.origin, {
                    transports: ["websocket", "polling"],
                    reconnectionAttempts: 3
                });

                this.socket.on("connect", () => {
                    this.isWsConnected = true;
                    if (this.wsBadge) {
                        this.wsBadge.innerText = "WS 60 FPS";
                        this.wsBadge.style.color = "#10b981";
                        this.wsBadge.style.borderColor = "#10b981";
                    }
                });

                this.socket.on("disconnect", () => {
                    this.isWsConnected = false;
                    if (this.wsBadge) {
                        this.wsBadge.innerText = "REST";
                        this.wsBadge.style.color = "#94a3b8";
                        this.wsBadge.style.borderColor = "#64748b";
                    }
                });

                this.socket.on("frame_processed", (data) => {
                    if (data && data.status === "success") {
                        this.handleProcessedImageResponse(data);
                    }
                });
            }
        } catch (e) {
            console.warn("WebSocket fallback:", e);
        }
    }

    switchCategory(cat) {
        this.activeCategory = cat;
        const tabDip = document.getElementById("tabDipFilters");
        const tabAr = document.getElementById("tabArTryOn");

        if (tabDip && tabAr) {
            if (cat === "dip") {
                tabDip.classList.add("active");
                tabAr.classList.remove("active");
            } else {
                tabDip.classList.remove("active");
                tabAr.classList.add("active");
            }
        }
        this.renderShelfItems();
    }

    setControlMode(mode) {
        this.controlMode = mode;
        const btnHand = document.getElementById("btnModeHand");
        const btnNose = document.getElementById("btnModeNose");

        if (btnHand && btnNose) {
            if (mode === "hand") {
                btnHand.classList.add("active");
                btnNose.classList.remove("active");
                if (this.cursorElement) this.cursorElement.classList.remove("state-nose");
                this.app.showToast("وضع تتبع اليد مفعل 🖐️", "🖐️");
            } else {
                btnHand.classList.remove("active");
                btnNose.classList.add("active");
                if (this.cursorElement) this.cursorElement.classList.add("state-nose");
                this.app.showToast("وضع توجيه الأنف مفعل (تحكم بالوجه) 👃", "♿");
            }
        }
    }

    renderShelfItems() {
        const container = document.getElementById("shelfItemsList");
        if (!container) return;

        container.innerHTML = "";

        // زر سريع في تبويب AR لتحميل صورة وجه للتجربة الفورية
        if (this.activeCategory === "ar") {
            const mirrorBtn = document.createElement("button");
            mirrorBtn.className = "ps-btn ps-btn-accent";
            mirrorBtn.style.cssText = "margin-bottom:8px; font-size:11px; padding:6px 10px; background:linear-gradient(135deg, #0070f3, #00dfd8); border:none; width:100%; font-weight:bold; box-shadow: 0 0 15px rgba(0, 223, 216, 0.4); border-radius:4px; cursor:pointer;";
            mirrorBtn.innerHTML = "🪞 فتح غرفة المراية الحية (Live AR Mirror)";
            mirrorBtn.onclick = () => {
                if (typeof toggleARMirror === "function") {
                    toggleARMirror();
                }
            };
            container.appendChild(mirrorBtn);

            const demoBtn = document.createElement("button");
            demoBtn.className = "ps-btn ps-btn-accent";
            demoBtn.style.cssText = "margin-bottom:6px; font-size:10px; padding:4px 6px; background:linear-gradient(135deg, #00e5ff, #0070f3); border:none; width:100%; border-radius:4px; cursor:pointer;";
            demoBtn.innerHTML = "👤 تحميل صورة وجه للتجربة الثابتة";
            demoBtn.onclick = () => {
                this.app.loadSampleImage("portrait_model.png");
                this.app.showToast("تم تحميل صورة الوجه التجريبية! اسحب النظارة أو البدلة عليها 👗", "👤");
            };
            container.appendChild(demoBtn);
        }

        const toolList = (this.activeCategory === "ar") ? this.arTools : this.dipTools;

        toolList.forEach(tool => {
            const card = document.createElement("div");
            card.className = "shelf-card";
            card.dataset.toolId = tool.id;
            card.dataset.toolType = tool.type;
            card.setAttribute("draggable", "true");
            card.innerHTML = `
                <div class="shelf-card-icon">${tool.icon}</div>
                <div class="shelf-card-info">
                    <span class="shelf-card-title">${tool.title}</span>
                    <span class="shelf-card-sub">${tool.sub}</span>
                </div>
            `;

            // 1. دعم السحب بالفأرة التقليدية (HTML5 Drag Start)
            card.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("application/json", JSON.stringify(tool));
                e.dataTransfer.effectAllowed = "copy";
                card.classList.add("is-being-dragged");
            });

            card.addEventListener("dragend", () => {
                card.classList.remove("is-being-dragged");
                if (this.app.docFrame) this.app.docFrame.classList.remove("doc-frame-drop-active");
            });

            // 2. النقر المباشر للتطبيق
            card.addEventListener("click", () => {
                this.executeTool(tool);
            });

            container.appendChild(card);
        });
    }

    async toggle() {
        if (this.isEnabled) {
            this.stop();
        } else {
            await this.start();
        }
    }

    async start() {
        try {
            if (window.arMirrorStudio && window.arMirrorStudio.isActive) {
                try { window.arMirrorStudio.close(); } catch(e) {}
            }
            this.updateBadge("Initializing AI Core...", "#ffd600");
            const toggleBtn = document.getElementById("btnToggleGestures");
            if (toggleBtn) toggleBtn.classList.add("active");

            if (this.pipContainer) this.pipContainer.style.display = "flex";
            if (this.cursorElement) this.cursorElement.style.display = "block";
            const shelf = document.getElementById("gestureToolShelf");
            if (shelf) shelf.classList.remove("shelf-hidden");

            // تشغيل MediaPipe Hands بحساسية عالية ونموذج متقدم
            if (!this.hands && typeof Hands !== "undefined") {
                this.hands = new Hands({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
                });

                this.hands.setOptions({
                    maxNumHands: 4,
                    modelComplexity: 1,
                    minDetectionConfidence: 0.30,
                    minTrackingConfidence: 0.30
                });

                this.hands.onResults((results) => this.onHandResults(results));
            }

            // تشغيل MediaPipe Face Mesh
            if (!this.faceMesh && typeof FaceMesh !== "undefined") {
                this.faceMesh = new FaceMesh({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
                });

                this.faceMesh.setOptions({
                    maxNumFaces: 1,
                    refineLandmarks: true,
                    minDetectionConfidence: 0.50,
                    minTrackingConfidence: 0.50
                });

                this.faceMesh.onResults((results) => this.onFaceResults(results));
            }

            // تشغيل تدفق الكاميرا (إما كاميرا الجوال IP Webcam أو كاميرا اللابتوب)
            if (this.cameraSource === "ipcam" && this.ipCamUrl) {
                this.startIpCameraStream(this.ipCamUrl);
            } else {
                await this.startLocalCamera();
            }

            this.isEnabled = true;
            if (this.statusDot) this.statusDot.classList.remove("no-hand");
            this.app.showToast("التحكم المكاني مفعل! اسحب النظارة أو الفلتر فوق الصورة 🖐️", "🚀");

        } catch (err) {
            console.error("Failed to start MediaPipe:", err);
            this.updateBadge("Camera Error", "#ff007f");
            this.app.showToast("تعذر تشغيل الكاميرا أو تحميل مكتبة الرؤية!", "⚠️");
            this.stop();
        }
    }

    startIpCameraStream(url) {
        if (!url) url = "http://192.168.8.106:8080/video";
        if (!url.includes("/video") && !url.includes(".mjpg")) {
            url = url.replace(/\/$/, "") + "/video";
        }
        this.cameraSource = "ipcam";
        this.ipCamUrl = url;
        localStorage.setItem("visioncraft_cam_source", "ipcam");
        localStorage.setItem("visioncraft_ipcam_url", url);

        // 1. Cancel local loop and clean up mediaStream
        if (this.localLoopId) {
            cancelAnimationFrame(this.localLoopId);
            this.localLoopId = null;
        }
        if (this.mediaStream) {
            try { this.mediaStream.getTracks().forEach(t => t.stop()); } catch(e) {}
            this.mediaStream = null;
        }
        if (this.videoElement && this.videoElement.srcObject) {
            try { this.videoElement.srcObject.getTracks().forEach(t => t.stop()); } catch(e) {}
            this.videoElement.srcObject = null;
        }
        if (this.camera) {
            try { this.camera.stop(); } catch(e) {}
            this.camera = null;
        }

        // 2. Cancel previous IP Cam loop
        if (this.ipCamLoopId) {
            cancelAnimationFrame(this.ipCamLoopId);
            this.ipCamLoopId = null;
        }

        let ipImg = document.getElementById("gestureIpCamImg");
        if (!ipImg) {
            ipImg = document.createElement("img");
            ipImg.id = "gestureIpCamImg";
            ipImg.crossOrigin = "anonymous";
            ipImg.style.cssText = "width:100%; height:100%; object-fit:cover; transform:scaleX(-1); position:absolute; top:0; left:0;";
            const pipBody = document.querySelector(".pip-body");
            if (pipBody) pipBody.insertBefore(ipImg, pipBody.firstChild);
        }
        ipImg.src = url;
        ipImg.style.display = "block";
        if (this.videoElement) this.videoElement.style.display = "none";
        this.ipCamImg = ipImg;

        let isProcessing = false;
        const processFrame = async () => {
            if (!this.isEnabled || this.cameraSource !== "ipcam") return;
            if (!isProcessing && this.ipCamImg && this.ipCamImg.naturalWidth > 0) {
                isProcessing = true;
                try {
                    if (this.hands) await this.hands.send({ image: this.ipCamImg });
                } catch(e) {}
                try {
                    if (this.faceMesh) await this.faceMesh.send({ image: this.ipCamImg });
                } catch(e) {}
                isProcessing = false;
            }
            this.ipCamLoopId = requestAnimationFrame(processFrame);
        };
        this.ipCamLoopId = requestAnimationFrame(processFrame);
        this.updateBadge("📱 IP Cam Live", "#10b981");
    }

    async startLocalCamera() {
        this.cameraSource = "local";
        localStorage.setItem("visioncraft_cam_source", "local");

        // 1. Cancel IP cam loops and hide img
        if (this.ipCamLoopId) {
            cancelAnimationFrame(this.ipCamLoopId);
            this.ipCamLoopId = null;
        }
        const ipImg = document.getElementById("gestureIpCamImg");
        if (ipImg) ipImg.style.display = "none";
        if (this.videoElement) this.videoElement.style.display = "block";

        // 2. Clean up previous stream and loop
        if (this.localLoopId) {
            cancelAnimationFrame(this.localLoopId);
            this.localLoopId = null;
        }
        if (this.mediaStream) {
            try { this.mediaStream.getTracks().forEach(t => t.stop()); } catch(e) {}
            this.mediaStream = null;
        }
        if (this.camera) {
            try { this.camera.stop(); } catch(e) {}
            this.camera = null;
        }
        if (this.videoElement && this.videoElement.srcObject) {
            try { this.videoElement.srcObject.getTracks().forEach(t => t.stop()); } catch(e) {}
            this.videoElement.srcObject = null;
        }

        // 3. Acquire webcam with fallbacks
        try {
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
                    audio: false
                });
            } catch (e1) {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            }

            this.mediaStream = stream;
            if (this.videoElement) {
                this.videoElement.srcObject = stream;
                await this.videoElement.play().catch(() => {});
            }

            this.startLocalDetectionLoop();
            this.updateBadge("🖐️ Gestures Active", "#00e5ff");
        } catch (err) {
            console.error("Local camera gesture activation error:", err);
            this.updateBadge("Camera Error", "#ff007f");
            this.app.showToast("⚠️ تعذر تشغيل كاميرا الكمبيوتر للتحكم بالإيماءات: " + (err.message || err), "❌");
        }
    }

    startLocalDetectionLoop() {
        if (this.localLoopId) {
            cancelAnimationFrame(this.localLoopId);
            this.localLoopId = null;
        }
        let isDetecting = false;
        const detect = async () => {
            if (!this.isEnabled || this.cameraSource !== "local") return;
            if (!isDetecting && this.videoElement && this.videoElement.readyState >= 2 && !this.videoElement.paused) {
                isDetecting = true;
                try {
                    if (this.hands) await this.hands.send({ image: this.videoElement });
                } catch(e) {}
                try {
                    if (this.faceMesh) await this.faceMesh.send({ image: this.videoElement });
                } catch(e) {}
                isDetecting = false;
            }
            this.localLoopId = requestAnimationFrame(detect);
        };
        this.localLoopId = requestAnimationFrame(detect);
    }

    setCameraSource(src, url) {
        if (src === "ipcam") {
            this.startIpCameraStream(url || this.ipCamUrl);
        } else {
            this.startLocalCamera();
        }
    }

    stop() {
        this.isEnabled = false;
        if (this.localLoopId) {
            cancelAnimationFrame(this.localLoopId);
            this.localLoopId = null;
        }
        if (this.mediaStream) {
            try { this.mediaStream.getTracks().forEach(t => t.stop()); } catch(e) {}
            this.mediaStream = null;
        }
        if (this.camera) {
            try { this.camera.stop(); } catch (e) {}
            this.camera = null;
        }
        if (this.ipCamLoopId) {
            cancelAnimationFrame(this.ipCamLoopId);
            this.ipCamLoopId = null;
        }
        if (this.ipCamImg) {
            this.ipCamImg.src = "";
            this.ipCamImg = null;
        }
        const ipImg = document.getElementById("gestureIpCamImg");
        if (ipImg) ipImg.style.display = "none";
        if (this.videoElement) this.videoElement.style.display = "block";

        if (this.videoElement && this.videoElement.srcObject) {
            try {
                this.videoElement.srcObject.getTracks().forEach(t => t.stop());
                this.videoElement.srcObject = null;
            } catch(e) {}
        }

        const toggleBtn = document.getElementById("btnToggleGestures");
        if (toggleBtn) toggleBtn.classList.remove("active");

        if (this.pipContainer) this.pipContainer.style.display = "none";
        if (this.cursorElement) this.cursorElement.style.display = "none";
        if (this.ghostElement) this.ghostElement.style.display = "none";
        this.resetProgressRing();

        const shelf = document.getElementById("gestureToolShelf");
        if (shelf) shelf.classList.add("shelf-hidden");

        this.isHoldingTool = false;
        this.activeToolData = null;
        if (this.hoveredCard) {
            this.hoveredCard.classList.remove("hand-hover");
            this.hoveredCard = null;
        }

        this.app.showToast("تم إيقاف التحكم بالإيماءات", "🔒");
    }

    onHandResults(results) {
        if (!this.isEnabled) return;

        this.drawHandSkeleton(results);

        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            if (this.controlMode === "hand") {
                if (this.statusDot) this.statusDot.classList.add("no-hand");
                this.updateBadge("No Hand Visible", "#f59e0b");
                this.prevScissorsDist = null;
                this.resetProgressRing();
            }
            return;
        }

        if (this.statusDot) this.statusDot.classList.remove("no-hand");

        let hand1 = results.multiHandLandmarks[0];
        let hand2 = results.multiHandLandmarks.length > 1 ? results.multiHandLandmarks[1] : null;

        // اختيار اليد التفاعلية الذكية: نفضل اليد المرفوعة للأعلى أو التي تشير بالسبابة على اليد المستقرة في الأسفل
        if (results.multiHandLandmarks.length > 1) {
            let bestScore = -9999;
            results.multiHandLandmarks.forEach((h, idx) => {
                let score = 0;
                score += (1.0 - h[0].y) * 120; // اليد المرتفعة نحو الشاشة تأخذ أولوية
                score += (1.0 - h[8].y) * 80;
                if (h[8].y < h[6].y) score += 150; // سبابة مفرودة
                if (h[8].y < h[6].y && h[12].y > h[10].y) score += 200; // وضعية مؤشر السبابة الحصري
                if (score > bestScore) {
                    bestScore = score;
                    hand1 = h;
                    hand2 = (idx === 0) ? results.multiHandLandmarks[1] : results.multiHandLandmarks[0];
                }
            });
        }

        const wrist = hand1[0];
        const thumbTip = hand1[4];
        const thumbIp = hand1[3];
        const indexTip = hand1[8];
        const indexPip = hand1[6];
        const middleTip = hand1[12];
        const middlePip = hand1[10];
        const ringTip = hand1[16];
        const ringPip = hand1[14];
        const pinkyTip = hand1[20];
        const pinkyPip = hand1[18];

        const isIndexUp = indexTip.y < indexPip.y;
        const isMiddleUp = middleTip.y < middlePip.y;
        const isRingUp = ringTip.y < ringPip.y;
        const isPinkyUp = pinkyTip.y < pinkyPip.y;

        // 1. تحويل الإحداثيات إلى بكسلات الشاشة مع فلتر متكيف ذكي (Velocity-Adaptive 1€ Filter)
        if (this.controlMode === "hand") {
            const targetScreenX = (1.0 - indexTip.x) * window.innerWidth;
            const targetScreenY = indexTip.y * window.innerHeight;

            const dx = targetScreenX - this.cursorX;
            const dy = targetScreenY - this.cursorY;
            const dist = Math.hypot(dx, dy);

            // عند السكون أو الحركة الدقيقة: تنعيم فائق لثبات مطلق (0.15)
            // عند الحركة السريعة: استجابة فورية (0.75) بسرعة 0ms
            const speedFactor = Math.min(1.0, Math.max(0.0, (dist - 4.0) / 32.0));
            const dynamicAlpha = 0.15 + (speedFactor * 0.60);

            this.cursorX += dx * dynamicAlpha;
            this.cursorY += dy * dynamicAlpha;

            // انجذاب مغناطيسي ناعم للعناصر التفاعلية عند التحويم (Magnetic Soft-Snap)
            if (this.hoveredCard) {
                const cardRect = this.hoveredCard.getBoundingClientRect();
                const cardCenterX = cardRect.left + cardRect.width / 2;
                const cardCenterY = cardRect.top + cardRect.height / 2;
                const distToCard = Math.hypot(cardCenterX - this.cursorX, cardCenterY - this.cursorY);
                if (distToCard < 42) {
                    this.cursorX += (cardCenterX - this.cursorX) * 0.26;
                    this.cursorY += (cardCenterY - this.cursorY) * 0.26;
                }
            }

            this.updateCursorPosition(this.cursorX, this.cursorY);
        }

        const now = Date.now();

        // 2. إيماءة التراجع السريع: Swipe Left
        const wristScreenX = (1.0 - wrist.x) * window.innerWidth;
        if (this.prevWristX !== null && this.prevWristTime !== null) {
            const dt = (now - this.prevWristTime) / 1000.0;
            if (dt > 0.01 && dt < 0.25) {
                const vx = (wristScreenX - this.prevWristX) / dt;
                if (vx < -1300 && (now - this.lastSwipeTime > 1200)) {
                    this.lastSwipeTime = now;
                    this.triggerSwipeUndo();
                    return;
                }
            }
        }
        this.prevWristX = wristScreenX;
        this.prevWristTime = now;

        // 3. إيماءة الحفظ: Thumbs Up
        const isThumbUp = (thumbTip.y < thumbIp.y - 0.05);
        const otherFingersDown = (!isIndexUp && !isMiddleUp && !isRingUp && !isPinkyUp);

        if (isThumbUp && otherFingersDown) {
            this.handleThumbsUpSave(now);
            return;
        } else {
            this.resetProgressRing();
        }

        // 4. إيماءة التكبير والتصغير (Scissors أو Dual Hand)
        if (hand2) {
            const index2 = hand2[8];
            const dualDist = Math.hypot(indexTip.x - index2.x, indexTip.y - index2.y);
            this.executeZoomDelta(dualDist, indexTip, index2);
            return;
        }

        if (isIndexUp && isMiddleUp && !isRingUp && !isPinkyUp) {
            const currentDist = Math.hypot(indexTip.x - middleTip.x, indexTip.y - middleTip.y);
            this.executeZoomDelta(currentDist, indexTip, middleTip);
            return;
        } else {
            this.prevScissorsDist = null;
            if (this.cursorElement) this.cursorElement.classList.remove("state-zoom");
        }

        // 5. الإمساك والإفلات بالقرص بنظام المعايرة النسبية والعتبة المزدوجة (Scale-Invariant Hysteresis Pinch)
        const middleMcp = hand1[9];
        const handScale = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y);
        const pinchDistance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
        const pinchRatio = pinchDistance / Math.max(0.015, handScale);

        // عتبة مزدوجة مانعة للتذبذب (Hysteresis Schmitt Trigger):
        // الإمساك يحتاج تقارب دقيق (< 0.22)، والإفلات لا يحدث إلا بتوسع كافي (> 0.38)
        const PINCH_GRAB_RATIO = 0.22;
        const PINCH_RELEASE_RATIO = 0.38;

        const isPinch = this.isHoldingTool ? (pinchRatio < PINCH_RELEASE_RATIO) : (pinchRatio < PINCH_GRAB_RATIO);
        const isOpenPalm = (isIndexUp && isMiddleUp && isRingUp && isPinkyUp) || (pinchRatio > PINCH_RELEASE_RATIO);

        if (this.controlMode === "hand") {
            this.checkShelfHover(this.cursorX, this.cursorY);
        }

        // التقاط الأداة
        if (isPinch && this.hoveredCard && !this.isHoldingTool) {
            this.pinchHoldFrames++;
            if (this.pinchHoldFrames >= 2) {
                const toolId = this.hoveredCard.dataset.toolId;
                const toolType = this.hoveredCard.dataset.toolType;
                const list = (toolType === "ar") ? this.arTools : this.dipTools;
                const tool = list.find(t => t.id === toolId);
                if (tool) {
                    this.grabTool(tool);
                }
            }
        } else if (!isPinch) {
            this.pinchHoldFrames = 0;
        }

        // السحب والإفلات
        if (this.isHoldingTool) {
            if (this.cursorElement) this.cursorElement.classList.add("state-grab");
            this.updateBadge(`✊ Holding: ${this.activeToolData.title}`, "#ff007f");

            // فحص التواجد فوق منطقة الكانفاس
            const vpRect = this.app.viewport.getBoundingClientRect();
            const isOverViewport = (
                this.cursorX >= vpRect.left &&
                this.cursorX <= vpRect.right &&
                this.cursorY >= vpRect.top &&
                this.cursorY <= vpRect.bottom
            );

            if (isOverViewport) {
                if (this.app.docFrame) this.app.docFrame.classList.add("doc-frame-drop-active");
            } else {
                if (this.app.docFrame) this.app.docFrame.classList.remove("doc-frame-drop-active");
            }

            // الإفلات عند فتح اليد أو انتهاء القرص فوق الكانفاس
            if (isOpenPalm && isOverViewport) {
                const rawRect = this.app.canvasRaw.getBoundingClientRect();
                let canvasX = Math.round((this.cursorX - rawRect.left) * (this.app.canvasRaw.naturalWidth / rawRect.width));
                let canvasY = Math.round((this.cursorY - rawRect.top) * (this.app.canvasRaw.naturalHeight / rawRect.height));

                canvasX = Math.max(0, Math.min(this.app.canvasRaw.naturalWidth, canvasX));
                canvasY = Math.max(0, Math.min(this.app.canvasRaw.naturalHeight, canvasY));

                this.dropTool(this.cursorX, this.cursorY, { x: canvasX, y: canvasY });
            }
        } else {
            if (this.cursorElement) this.cursorElement.classList.remove("state-grab");
            if (this.app.docFrame) this.app.docFrame.classList.remove("doc-frame-drop-active");

            if (isIndexUp && !isMiddleUp && !isRingUp && !isPinkyUp) {
                this.updateBadge("👆 Laser Pointer", "#00e5ff");
            } else if (isOpenPalm) {
                this.updateBadge("✋ Open Palm", "#10b981");
            }
        }
    }

    onFaceResults(results) {
        if (!this.isEnabled || !results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            this.latestFaceLandmarks = null;
            return;
        }

        const landmarks = results.multiFaceLandmarks[0];
        this.latestRawFaceLandmarks = landmarks;

        this.latestFaceLandmarks = {
            left_eye: [landmarks[33].x, landmarks[33].y],
            right_eye: [landmarks[263].x, landmarks[263].y],
            nose: [landmarks[1].x, landmarks[1].y],
            chin: [landmarks[152].x, landmarks[152].y],
            forehead: [landmarks[10].x, landmarks[10].y]
        };

        const now = Date.now();

        // وضع توجيه الأنف
        if (this.controlMode === "nose") {
            const noseTip = landmarks[1];
            const targetX = (1.0 - noseTip.x) * window.innerWidth;
            const targetY = noseTip.y * window.innerHeight;

            this.cursorX = (this.emaAlpha * targetX) + ((1.0 - this.emaAlpha) * this.cursorX);
            this.cursorY = (this.emaAlpha * targetY) + ((1.0 - this.emaAlpha) * this.cursorY);

            this.updateCursorPosition(this.cursorX, this.cursorY);
            this.checkShelfHover(this.cursorX, this.cursorY);
            this.updateBadge("👃 Nose Navigation Active", "#10b981");
        }

        // تفاعل فتح الفم
        const upperLip = landmarks[13];
        const lowerLip = landmarks[14];
        const faceTop = landmarks[10];
        const faceBottom = landmarks[152];
        const faceHeight = Math.hypot(faceTop.x - faceBottom.x, faceTop.y - faceBottom.y);
        const mouthDist = Math.hypot(upperLip.x - lowerLip.x, upperLip.y - lowerLip.y);

        if (faceHeight > 0.05) {
            const mouthRatio = mouthDist / faceHeight;
            if (mouthRatio > 0.16 && (now - this.lastMouthTime > 1500)) {
                this.lastMouthTime = now;
                this.triggerMouthAction();
            }
        }

        // تفاعل الغمز بالعين
        const leftEar = this.calculateEAR(landmarks[159], landmarks[145], landmarks[33], landmarks[133]);
        const rightEar = this.calculateEAR(landmarks[386], landmarks[374], landmarks[362], landmarks[263]);

        if (now - this.lastWinkTime > 1400) {
            if (leftEar < 0.15 && rightEar > 0.24) {
                this.lastWinkTime = now;
                this.triggerLeftEyeWink();
            } else if (rightEar < 0.15 && leftEar > 0.24) {
                this.lastWinkTime = now;
                this.triggerRightEyeWink();
            }
        }
    }

    calculateEAR(top, bottom, left, right) {
        const vertical = Math.hypot(top.x - bottom.x, top.y - bottom.y);
        const horizontal = Math.hypot(left.x - right.x, left.y - right.y);
        return (horizontal > 0) ? (vertical / horizontal) : 0.25;
    }

    executeZoomDelta(currentDist, pt1, pt2) {
        if (this.cursorElement) this.cursorElement.classList.add("state-zoom");

        if (this.prevScissorsDist !== null) {
            const delta = currentDist - this.prevScissorsDist;
            if (Math.abs(delta) > 0.003) {
                const zoomFactor = 1.0 + (delta * 4.0);
                const midX = (1.0 - (pt1.x + pt2.x) / 2.0) * window.innerWidth;
                const midY = ((pt1.y + pt2.y) / 2.0) * window.innerHeight;

                this.app.zoomAtPoint(zoomFactor, midX, midY);

                const percent = Math.round(this.app.zoomScale * 100);
                this.updateBadge(`🔍 Zooming (${percent}%)`, "#ffd600");
            }
        }
        this.prevScissorsDist = currentDist;
    }

    triggerSwipeUndo() {
        this.updateBadge("⏪ Swipe Left: Undo", "#ff007f");
        this.app.showToast("التراجع السريع عن آخر تعديل (Swipe Left Undo) ⏪", "↩️");
        if (typeof this.app.setFilter === "function") {
            this.app.setFilter("none", {}, "Original Image", "");
            this.app.setSplitPercent(50);
        }
    }

    handleThumbsUpSave(now) {
        if (!this.thumbsUpStartTime) {
            this.thumbsUpStartTime = now;
        }

        const elapsed = (now - this.thumbsUpStartTime) / 1000.0;
        const progress = Math.min(1.0, elapsed / 1.0);

        if (this.progressRingCircle) {
            const ring = document.getElementById("cursorProgressRing");
            if (ring) ring.style.display = "block";
            const offset = 100 - (progress * 100);
            this.progressRingCircle.style.strokeDashoffset = offset;
        }

        this.updateBadge(`👍 Saving... ${Math.round(progress * 100)}%`, "#ffd600");

        if (progress >= 1.0 && (now - this.lastSaveTime > 2500)) {
            this.lastSaveTime = now;
            this.thumbsUpStartTime = null;
            this.resetProgressRing();
            this.updateBadge("💾 Saved & Exported!", "#10b981");
            this.app.showToast("تم تصدير وحفظ الصورة النهائية (Thumbs Up) 👍💾", "✨");
            if (typeof this.app.downloadResult === "function") {
                this.app.downloadResult();
            }
        }
    }

    resetProgressRing() {
        this.thumbsUpStartTime = null;
        const ring = document.getElementById("cursorProgressRing");
        if (ring) ring.style.display = "none";
        if (this.progressRingCircle) {
            this.progressRingCircle.style.strokeDashoffset = 100;
        }
    }

    triggerMouthAction() {
        this.updateBadge("😮 Mouth Open Trigger", "#ffd600");
        this.app.showToast("تحفيز بالوجه: فتح الفم 😮", "🪄");
        this.app.setSplitPercent(this.app.splitPercent === 50 ? 0 : 50);
    }

    triggerLeftEyeWink() {
        this.updateBadge("😉 Left Wink: Split View", "#00e5ff");
        this.app.showToast("غمز بالعين اليسرى: تغيير وضع العرض 😉", "👁️");
        this.app.splitCycle = ((this.app.splitCycle || 0) + 1) % 3;
        this.app.setSplitPercent(this.app.splitCycle === 0 ? 50 : (this.app.splitCycle === 1 ? 0 : 100));
    }

    triggerRightEyeWink() {
        this.updateBadge("😜 Right Wink: Quick Click", "#10b981");
        this.app.showToast("غمز بالعين اليمنى: نقرة تفاعلية وتطبيق 😜", "📸");
        if (this.hoveredCard) {
            this.hoveredCard.click();
        }
    }

    checkShelfHover(screenX, screenY) {
        const cards = document.querySelectorAll(".shelf-card");
        let hovered = null;

        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            if (
                screenX >= rect.left &&
                screenX <= rect.right &&
                screenY >= rect.top &&
                screenY <= rect.bottom
            ) {
                hovered = card;
            }
        });

        if (this.hoveredCard && this.hoveredCard !== hovered) {
            this.hoveredCard.classList.remove("hand-hover");
            this.dwellHoverStartTime = null;
        }

        if (hovered) {
            hovered.classList.add("hand-hover");
            this.hoveredCard = hovered;
            if (!this.isHoldingTool) {
                const title = hovered.querySelector(".shelf-card-title") ? hovered.querySelector(".shelf-card-title").innerText : "العنصر";
                
                // ميزة النقر الذكي التلقائي بمؤشر السبابة (Dwell Click 0.75s)
                if (!this.dwellHoverStartTime) {
                    this.dwellHoverStartTime = Date.now();
                }
                const now = Date.now();
                const dwellElapsed = (now - this.dwellHoverStartTime) / 750.0;
                const progress = Math.min(1.0, dwellElapsed);

                if (this.progressRingCircle) {
                    const ring = document.getElementById("cursorProgressRing");
                    if (ring) ring.style.display = "block";
                    const offset = 100 - (progress * 100);
                    this.progressRingCircle.style.strokeDashoffset = offset;
                }

                this.updateBadge(`👆 تفعيل ${title}: ${Math.round(progress * 100)}%`, "#00e5ff");

                if (progress >= 1.0 && (!this.lastDwellClickTime || (now - this.lastDwellClickTime > 1500))) {
                    this.lastDwellClickTime = now;
                    this.dwellHoverStartTime = null;
                    this.resetProgressRing();
                    this.createDropRipple(screenX, screenY);
                    hovered.click();
                    this.updateBadge(`✅ تم اختيار ${title}`, "#10b981");
                    this.app.showToast(`تم اختيار ${title} بتوجيه السبابة 👆`, "🎯");
                }
            }
        } else {
            this.hoveredCard = null;
            this.dwellHoverStartTime = null;
            if (!this.thumbsUpStartTime) {
                this.resetProgressRing();
            }
        }
    }

    grabTool(tool) {
        this.isHoldingTool = true;
        this.activeToolData = tool;
        if (this.hoveredCard) this.hoveredCard.classList.add("is-being-dragged");

        if (this.ghostElement) {
            this.ghostElement.innerHTML = `
                <span class="ghost-icon">${tool.icon}</span>
                <div>
                    <div>${tool.title}</div>
                    <span class="ghost-hint">افلت فوق الوجه أو الكانفاس لتطبيق الأداة</span>
                </div>
            `;
            this.ghostElement.style.display = "flex";
        }

        this.app.showToast(`تم التقاط ${tool.title}! اسحبها وافلت فوق الصورة ✋`, "🤏");
    }

    dropTool(dropScreenX, dropScreenY, dropCoords = null) {
        const tool = this.activeToolData;
        this.isHoldingTool = false;
        this.activeToolData = null;

        if (this.ghostElement) this.ghostElement.style.display = "none";
        document.querySelectorAll(".shelf-card").forEach(c => c.classList.remove("is-being-dragged"));
        if (this.app.docFrame) this.app.docFrame.classList.remove("doc-frame-drop-active");

        this.createDropRipple(dropScreenX, dropScreenY);
        this.executeTool(tool, dropCoords);
    }

    /**
     * تنفيذ الأداة بدقة وموثوقية عالية (Direct Guaranteed REST & Realtime Update)
     */
    async executeTool(tool, dropCoords = null) {
        this.app.showToast(`جاري تطبيق ${tool.title}... ⚡`, "✨");
        this.updateBadge(`Applying: ${tool.title}`, "#10b981");

        const isAr = (tool.type === "ar");
        const operation = isAr ? "ar_tryon" : tool.op;

        if (isAr) {
            this.currentArTool = tool;
            if (dropCoords) this.currentArCoords = dropCoords;
            this.showArOptionsBar(tool);
        }

        const currentScale = (isAr && this.currentArScale) ? this.currentArScale : 2.25;

        const params = isAr ? {
            accessory: tool.accessory,
            category: tool.category,
            garment_id: tool.id,
            landmarks: this.latestFaceLandmarks || {},
            options: {
                scale: currentScale,
                category: tool.category,
                garment_id: tool.id,
                drop_coords: (dropCoords || this.currentArCoords) // تمرير موضع الإسقاط بدقة
            }
        } : (tool.params || {});

        const payload = {
            image: this.app.rawImageBase64,
            operation: operation,
            params: params
        };

        try {
            const resp = await fetch("/api/process", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await resp.json();
            if (data.status === "success") {
                this.handleProcessedImageResponse(data);
                // إظهار الصورة المعالجة كاملة للمستخدم دون اقتطاع شريط المقارنة
                this.app.setSplitPercent(0);
                this.app.showToast(`تم تركيب ${tool.title} بنجاح! ✨`, "🎉");
            } else {
                this.app.showToast(`تنبيه: ${data.message || 'حدث خطأ'}`, "⚠️");
            }
        } catch (err) {
            console.error("Execute tool error:", err);
            this.app.setFilter(operation, params, tool.headerTitle, "");
        }
    }

    showArOptionsBar(tool) {
        const bar = document.getElementById("arOptionsBar");
        const label = document.getElementById("arAccessoryLabel");
        const slider = document.getElementById("arScaleSlider");
        const scaleLabel = document.getElementById("arScaleLabel");

        if (bar && label && slider && scaleLabel) {
            bar.style.display = "flex";
            label.innerText = `${tool.icon} ${tool.title}:`;
            slider.value = this.currentArScale || 2.25;
            scaleLabel.innerText = `${slider.value}x`;
        }
    }

    updateArScale(val) {
        this.currentArScale = parseFloat(val);
        const scaleLabel = document.getElementById("arScaleLabel");
        if (scaleLabel) scaleLabel.innerText = `${val}x`;

        if (this.currentArTool) {
            this.executeTool(this.currentArTool, this.currentArCoords);
        }
    }

    mergeDownAr() {
        if (this.app.processedImageBase64) {
            this.app.commitNewBaseImage(this.app.processedImageBase64);
            const bar = document.getElementById("arOptionsBar");
            if (bar) bar.style.display = "none";
            this.currentArCoords = null;
            this.app.showToast("تم تثبيت الأكسسوار نهائياً على الصورة! يمكنك إضافة أكسسوار آخر فوقه 👗", "🎉");
        }
    }

    cancelAr() {
        if (this.app.rawImageBase64) {
            this.app.canvasProcessed.src = this.app.rawImageBase64;
            this.app.processedImageBase64 = this.app.rawImageBase64;
            const bar = document.getElementById("arOptionsBar");
            if (bar) bar.style.display = "none";
            this.currentArCoords = null;
            this.app.showToast("تم إلغاء الأكسسوار والرجوع للأصل", "↩️");
        }
    }


    handleProcessedImageResponse(data) {
        if (!data || !data.image) return;

        this.app.processedImageBase64 = data.image;
        this.app.canvasProcessed.src = data.image;
        this.app.cacheProcessedImageBitmap();

        if (data.histogram) this.app.renderHistogram(data.histogram);
        if (data.stats) this.app.updateStats(data.stats, data.execution_time_ms);
        if (data.formula) this.app.formulaBox.innerText = data.formula;
        if (data.code) this.app.codeSnippet.innerText = data.code;
        if (this.app.perfBadge) {
            this.app.perfBadge.innerText = `⚡ ${data.execution_time_ms}ms (OpenCV Engine)`;
        }
    }

    createDropRipple(screenX, screenY) {
        const ripple = document.createElement("div");
        ripple.className = "gesture-drop-ripple";
        ripple.style.left = `${screenX}px`;
        ripple.style.top = `${screenY}px`;
        document.body.appendChild(ripple);

        setTimeout(() => {
            if (ripple && ripple.parentNode) {
                ripple.parentNode.removeChild(ripple);
            }
        }, 800);
    }

    updateCursorPosition(x, y) {
        if (this.cursorElement) {
            this.cursorElement.style.left = `${x}px`;
            this.cursorElement.style.top = `${y}px`;
        }

        if (this.ghostElement && this.isHoldingTool) {
            this.ghostElement.style.left = `${x}px`;
            this.ghostElement.style.top = `${y}px`;
        }
    }

    updateBadge(text, color = "#00e5ff") {
        if (this.feedbackBadge) {
            this.feedbackBadge.innerText = text;
            this.feedbackBadge.style.borderColor = color;
            this.feedbackBadge.style.color = color;
            this.feedbackBadge.style.textShadow = `0 0 8px ${color}`;
        }
    }

    drawHandSkeleton(results) {
        if (!this.canvasCtx || !this.canvasElement) return;
        const ctx = this.canvasCtx;
        const w = this.canvasElement.width;
        const h = this.canvasElement.height;

        ctx.clearRect(0, 0, w, h);

        // 1. رسم شبكة ونقاط الوجه (Face Landmarks)
        if (this.latestRawFaceLandmarks && this.latestRawFaceLandmarks.length > 0) {
            ctx.save();
            const FACE_LOOPS = [
                [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
                [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],
                [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263],
                [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78, 61],
                [168, 6, 197, 195, 5, 4, 1, 19, 94, 2]
            ];

            ctx.strokeStyle = "rgba(0, 229, 255, 0.4)";
            ctx.lineWidth = 1;
            FACE_LOOPS.forEach(loop => {
                ctx.beginPath();
                for (let i = 0; i < loop.length; i++) {
                    const pt = this.latestRawFaceLandmarks[loop[i]];
                    if (!pt) continue;
                    if (i === 0) ctx.moveTo(pt.x * w, pt.y * h);
                    else ctx.lineTo(pt.x * w, pt.y * h);
                }
                ctx.stroke();
            });

            // نقاط العينين والأنف والجبين
            [10, 152, 1, 33, 263, 61, 291, 468, 473].forEach(idx => {
                const pt = this.latestRawFaceLandmarks[idx];
                if (!pt) return;
                ctx.beginPath();
                ctx.arc(pt.x * w, pt.y * h, 2, 0, 2 * Math.PI);
                ctx.fillStyle = "#00e5ff";
                ctx.fill();
            });
            ctx.restore();
        }

        // 2. رسم نقاط وهيكل اليدين والأصابع (Hands & Fingers Skeleton)
        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;

        results.multiHandLandmarks.forEach((landmarks, handIdx) => {
            const connections = [
                [0, 1], [1, 2], [2, 3], [3, 4],        // الإبهام
                [0, 5], [5, 6], [6, 7], [7, 8],        // السبابة
                [5, 9], [9, 10], [10, 11], [11, 12],   // الوسطى
                [9, 13], [13, 14], [14, 15], [15, 16], // البنصر
                [13, 17], [17, 18], [18, 19], [19, 20],// الخنصر
                [0, 17]
            ];

            ctx.strokeStyle = (handIdx === 0) ? "rgba(0, 255, 170, 0.85)" : "rgba(255, 0, 127, 0.85)";
            ctx.lineWidth = 2.2;
            connections.forEach(([i, j]) => {
                const p1 = landmarks[i];
                const p2 = landmarks[j];
                ctx.beginPath();
                ctx.moveTo(p1.x * w, p1.y * h);
                ctx.lineTo(p2.x * w, p2.y * h);
                ctx.stroke();
            });

            // مفاصل وأطراف الأصابع
            landmarks.forEach((pt, idx) => {
                ctx.beginPath();
                const isTip = (idx === 4 || idx === 8 || idx === 12 || idx === 16 || idx === 20);
                const radius = isTip ? 4.5 : 2.5;
                ctx.arc(pt.x * w, pt.y * h, radius, 0, 2 * Math.PI);
                ctx.fillStyle = (idx === 8) ? "#00e5ff" : (idx === 4 ? "#ffd600" : (isTip ? "#ff007f" : "#38bdf8"));
                ctx.fill();
            });

            // فحص وضعية السبابة المرفوعة للتوجيه (Pointing Gesture HUD)
            const indexTip = landmarks[8];
            const indexPip = landmarks[6];
            const middleTip = landmarks[12];
            const middlePip = landmarks[10];
            const isPointing = (indexTip.y < indexPip.y);

            if (isPointing) {
                const px = indexTip.x * w;
                const py = indexTip.y * h;
                
                ctx.save();
                ctx.shadowColor = "#00e5ff";
                ctx.shadowBlur = 14;
                ctx.strokeStyle = "#00e5ff";
                ctx.lineWidth = 1.8;

                // حلقة الهدف الدائرية
                ctx.beginPath();
                ctx.arc(px, py, 11, 0, 2 * Math.PI);
                ctx.stroke();

                // خطوط التصويب المتقاطعة
                ctx.beginPath();
                ctx.moveTo(px - 15, py); ctx.lineTo(px + 15, py);
                ctx.moveTo(px, py - 15); ctx.lineTo(px, py + 15);
                ctx.stroke();

                // وسم مؤشر السبابة الذكي
                ctx.fillStyle = "rgba(0, 229, 255, 0.95)";
                ctx.font = "bold 9px sans-serif";
                ctx.fillText("👆 POINTER", px + 12, py - 8);
                ctx.restore();
            }
        });
    }
}

// Global initialization helper
window.gestureController = null;
let gestureController = null;

function toggleAirGestures() {
    if (!window.gestureController && !gestureController && window.app) {
        window.gestureController = new GestureController(window.app);
        gestureController = window.gestureController;
    }
    const controller = window.gestureController || gestureController;
    if (controller) {
        controller.toggle();
    }
}
