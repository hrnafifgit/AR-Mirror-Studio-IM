/**
 * ==============================================================================
 * VisionCraft Studio - Photo Virtual Try-On Studio Engine
 * استوديو تجربة الملابس للصور الثابتة عبر محرك TPS والتحييد الذكي
 * يدعم الكشف التلقائي عن معالم الجسم والوجه وتصحيح التوجيه
 * ==============================================================================
 */

class PhotoTryonStudio {
    constructor(appInstance) {
        this.app = appInstance;
        this.modal = null;
        this.catalog = null;
        this.selectedModelBase64 = null;
        this.selectedGarmentId = "suite_1";
        this.customGarmentBase64 = null;
        this.resultBase64 = null;
        this.currentCategory = "suite";
        this.detectedLandmarks = null;
        this.poseTracker = null;
        this.faceTracker = null;

        this.init();
    }

    async init() {
        this.loadCatalog();
        this.createModalDOM();
    }

    async loadCatalog() {
        try {
            const resp = await fetch("/api/catalog");
            if (resp.ok) {
                this.catalog = await resp.json();
                this.renderCategoryTabs();
                this.renderGarmentsGrid();
            }
        } catch (e) {
            console.warn("Could not load catalog:", e);
        }
    }

    createModalDOM() {
        if (document.getElementById("photoTryonModal")) return;

        const modal = document.createElement("div");
        modal.id = "photoTryonModal";
        modal.className = "ps-modal";
        modal.style.cssText = "display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); z-index:99999; align-items:center; justify-content:center; font-family:'Segoe UI', sans-serif;";

        modal.innerHTML = `
            <div style="background:#141a29; border:1px solid rgba(168,85,247,0.4); border-radius:12px; width:94vw; max-width:1150px; height:90vh; max-height:780px; display:flex; flex-direction:column; box-shadow:0 25px 60px rgba(0,0,0,0.7); overflow:hidden;">
                
                <!-- Modal Header -->
                <div style="padding:14px 22px; background:linear-gradient(90deg, #1e293b, #0f172a); border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:24px;">👗</span>
                        <div>
                            <h3 style="margin:0; font-size:16px; font-weight:700; color:#f8fafc; display:flex; align-items:center; gap:8px;">
                                Photo Virtual Try-On Studio
                                <span style="background:linear-gradient(135deg, #a855f7, #ec4899); color:#fff; font-size:10px; font-weight:700; padding:2px 8px; border-radius:12px;">TPS Elastic AI</span>
                            </h3>
                            <span style="font-size:11px; color:#94a3b8;">استوديو تجربة الملابس والإكسسوارات مع كشف المعالم التشريحية التلقائي ومحاكاة انحناء الأنسجة</span>
                        </div>
                    </div>
                    <button class="ps-btn" style="border:none; background:rgba(255,255,255,0.08); color:#cbd5e1; font-size:16px; width:32px; height:32px; border-radius:50%; padding:0; cursor:pointer;" onclick="photoTryonStudio.close()">✕</button>
                </div>

                <!-- Modal Body: 3 Columns -->
                <div style="display:grid; grid-template-columns: 290px 1fr 340px; flex:1; overflow:hidden; divide-x:1px solid #334155;">
                    
                    <!-- Column 1: Model Image Selector -->
                    <div style="padding:16px; background:#0f172a; border-left:1px solid rgba(255,255,255,0.05); display:flex; flex-direction:column; gap:10px; overflow-y:auto;">
                        <span style="font-size:12px; font-weight:700; color:#cbd5e1; text-transform:uppercase; letter-spacing:0.5px;">1. صورة الشخص (Model)</span>
                        
                        <div style="display:flex; gap:6px;">
                            <button class="ps-btn ps-btn-accent" style="flex:1; font-size:11px; padding:6px 4px;" onclick="photoTryonStudio.useCanvasImage()">🖼️ من الكانفاس</button>
                            <label class="ps-btn" style="flex:1; font-size:11px; padding:6px 4px; text-align:center; cursor:pointer; background:rgba(255,255,255,0.08);">
                                📁 رفع صورة
                                <input type="file" accept="image/*" style="display:none;" onchange="photoTryonStudio.handleModelUpload(event)">
                            </label>
                            <button class="ps-btn" style="width:36px; font-size:14px; padding:6px 0; text-align:center; background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.15);" title="تدوير الصورة 90 درجة لتعديل الوقوف" onclick="photoTryonStudio.rotateModelImage()">⟳</button>
                        </div>

                        <!-- Preview Box -->
                        <div id="ptModelPreviewBox" style="width:100%; height:195px; background:#090d16; border:1px dashed rgba(255,255,255,0.15); border-radius:8px; display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative;">
                            <img id="ptModelThumb" style="max-width:100%; max-height:100%; object-fit:contain; display:none;">
                            <span id="ptModelPlaceholder" style="font-size:12px; color:#64748b; text-align:center; padding:15px;">لا توجد صورة محددة.<br>اضغط "من الكانفاس" أو "رفع صورة"</span>
                        </div>

                        <!-- AI Landmarks Status Indicator -->
                        <div id="ptPoseStatus" style="font-size:11px; color:#94a3b8; display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.03); padding:5px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.06);">
                            <span id="ptPoseIndicator">⚪</span>
                            <span id="ptPoseText" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">جاهز لتحليل معالم الشخص</span>
                        </div>

                        <!-- Controls -->
                        <div style="display:flex; flex-direction:column; gap:8px; margin-top:auto; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08);">
                            <div>
                                <div style="display:flex; justify-content:space-between; font-size:11px; color:#94a3b8; margin-bottom:2px;">
                                    <span>المقاس (Scale):</span>
                                    <span id="ptScaleVal" style="color:#38bdf8; font-weight:bold;">168%</span>
                                </div>
                                <input type="range" id="ptScaleSlider" class="ps-range" min="0.5" max="2.6" step="0.02" value="1.68" oninput="document.getElementById('ptScaleVal').innerText = Math.round(this.value * 100) + '%'">
                            </div>

                            <div>
                                <div style="display:flex; justify-content:space-between; font-size:11px; color:#94a3b8; margin-bottom:2px;">
                                    <span>الإزاحة الرأسية (Vertical):</span>
                                    <span id="ptOffsetVal" style="color:#38bdf8; font-weight:bold;">0px</span>
                                </div>
                                <input type="range" id="ptOffsetSlider" class="ps-range" min="-80" max="80" step="2" value="0" oninput="document.getElementById('ptOffsetVal').innerText = this.value + 'px'">
                            </div>

                            <div>
                                <div style="display:flex; justify-content:space-between; font-size:11px; color:#94a3b8; margin-bottom:2px;">
                                    <span>الإزاحة الأفقية (Horizontal):</span>
                                    <span id="ptOffsetXVal" style="color:#38bdf8; font-weight:bold;">0px</span>
                                </div>
                                <input type="range" id="ptOffsetXSlider" class="ps-range" min="-60" max="60" step="2" value="0" oninput="document.getElementById('ptOffsetXVal').innerText = this.value + 'px'">
                            </div>

                            <label id="ptAgnosticLabel" style="display:flex; align-items:center; gap:8px; font-size:11px; color:#cbd5e1; cursor:pointer;">
                                <input type="checkbox" id="ptAgnosticCheck" checked style="accent-color:#a855f7;">
                                <span>تحييد ومسح القميص القديم (Inpaint)</span>
                            </label>

                            <label id="ptTpsLabel" style="display:flex; align-items:center; gap:8px; font-size:11px; color:#cbd5e1; cursor:pointer;">
                                <input type="checkbox" id="ptTpsCheck" checked style="accent-color:#a855f7;">
                                <span>محاكاة انحناء القماش (TPS Elastic)</span>
                            </label>
                        </div>
                    </div>

                    <!-- Column 2: Garment Catalog & Upload -->
                    <div style="padding:16px; background:#111827; display:flex; flex-direction:column; gap:10px; overflow:hidden;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:12px; font-weight:700; color:#cbd5e1; text-transform:uppercase; letter-spacing:0.5px;">2. اختيار اللباس أو الأكسسوار</span>
                            <label class="ps-btn" style="font-size:11px; padding:4px 10px; cursor:pointer; background:rgba(168,85,247,0.15); border-color:#a855f7; color:#d8b4fe;">
                                📤 رفع لباس خاص (PNG)
                                <input type="file" accept="image/png" style="display:none;" onchange="photoTryonStudio.handleGarmentUpload(event)">
                            </label>
                        </div>

                        <!-- Category Tabs (Dynamically rendered for all categories) -->
                        <div id="ptCategoryTabs" style="display:flex; gap:6px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:8px; overflow-x:auto; scrollbar-width:thin;">
                        </div>

                        <!-- Garments Grid Container -->
                        <div id="ptGarmentsGrid" style="flex:1; display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr)); gap:10px; overflow-y:auto; padding-right:4px;">
                            <!-- Populated dynamically -->
                        </div>

                        <!-- Submit Run Button -->
                        <button class="ps-btn ps-btn-accent" style="width:100%; height:40px; font-size:14px; font-weight:700; background:linear-gradient(135deg, #a855f7, #ec4899); border-color:#d946ef; color:#fff; box-shadow:0 4px 15px rgba(217,70,239,0.35); cursor:pointer;" onclick="photoTryonStudio.runTryOn()">
                            🚀 تطبيق اللباس الذكي (Run TPS Try-On)
                        </button>
                    </div>

                    <!-- Column 3: Result Preview & Studio Injection -->
                    <div style="padding:16px; background:#0f172a; border-right:1px solid rgba(255,255,255,0.05); display:flex; flex-direction:column; gap:12px;">
                        <span style="font-size:12px; font-weight:700; color:#cbd5e1; text-transform:uppercase; letter-spacing:0.5px;">3. النتيجة النهائية</span>

                        <!-- Output Preview Box -->
                        <div id="ptResultBox" style="width:100%; height:320px; background:#090d16; border:1px solid rgba(255,255,255,0.1); border-radius:8px; display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative;">
                            <img id="ptResultImg" style="max-width:100%; max-height:100%; object-fit:contain; display:none;">
                            <div id="ptResultPlaceholder" style="font-size:12px; color:#64748b; text-align:center; padding:15px;">
                                اضغط على "تطبيق اللباس الذكي"<br>لعرض النتيجة هنا
                            </div>
                            <div id="ptSpinner" style="display:none; position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.85); flex-direction:column; align-items:center; justify-content:center; gap:10px;">
                                <div style="font-size:32px; animation:spin 1.5s linear infinite;">🪄</div>
                                <span style="font-size:12px; color:#c084fc; font-weight:bold;">جاري التحليل والمعالجة الذكية...</span>
                            </div>
                        </div>

                        <!-- Action Buttons -->
                        <div style="display:flex; flex-direction:column; gap:8px; margin-top:auto;">
                            <button id="ptBtnAddLayer" class="ps-btn ps-btn-accent" style="background:#059669; border-color:#10b981; color:#fff; font-weight:700; height:36px;" disabled onclick="photoTryonStudio.addAsLayer()">
                                📥 إدراج كطبقة جديدة في الفوتوشوب
                            </button>
                            <button id="ptBtnDownload" class="ps-btn" style="background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.15); color:#cbd5e1;" disabled onclick="photoTryonStudio.downloadResult()">
                                💾 تنزيل الصورة الناتجة
                            </button>
                        </div>
                    </div>

                </div>

            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
    }

    open() {
        if (!this.modal) this.createModalDOM();
        this.modal.style.display = "flex";
        if (!this.selectedModelBase64) {
            this.useCanvasImage();
        }
        this.renderCategoryTabs();
        this.renderGarmentsGrid();
    }

    close() {
        if (this.modal) this.modal.style.display = "none";
    }

    async detectModelLandmarks(base64Data) {
        const statusText = document.getElementById("ptPoseText");
        const statusIndicator = document.getElementById("ptPoseIndicator");
        if (statusText) statusText.innerText = "جاري كشف معالم الجسم والوجه بالذكاء الاصطناعي...";
        if (statusIndicator) statusIndicator.innerText = "⏳";

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = async () => {
            const detected = {};
            try {
                // 1. فحص معالم الجسم عبر MediaPipe Pose إذا توفر في المتصفح
                if (typeof Pose !== "undefined") {
                    if (!this.poseTracker) {
                        this.poseTracker = new Pose({
                            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
                        });
                        this.poseTracker.setOptions({
                            modelComplexity: 0,
                            smoothLandmarks: false,
                            minDetectionConfidence: 0.35
                        });
                    }

                    await new Promise((resolve) => {
                        const timer = setTimeout(resolve, 2200);
                        this.poseTracker.onResults((res) => {
                            clearTimeout(timer);
                            if (res.poseLandmarks && res.poseLandmarks.length > 0) {
                                const p = res.poseLandmarks;
                                detected["left_shoulder"] = [p[11].x, p[11].y];
                                detected["right_shoulder"] = [p[12].x, p[12].y];
                                detected["left_hip"] = [p[23].x, p[23].y];
                                detected["right_hip"] = [p[24].x, p[24].y];
                                detected["nose"] = [p[0].x, p[0].y];
                            }
                            resolve();
                        });
                        this.poseTracker.send({ image: img }).catch(resolve);
                    });
                }

                // 2. فحص ملامح الوجه عبر MediaPipe FaceMesh
                if (typeof FaceMesh !== "undefined") {
                    if (!this.faceTracker) {
                        this.faceTracker = new FaceMesh({
                            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
                        });
                        this.faceTracker.setOptions({
                            maxNumFaces: 1,
                            refineLandmarks: true,
                            minDetectionConfidence: 0.35
                        });
                    }

                    await new Promise((resolve) => {
                        const timer = setTimeout(resolve, 2200);
                        this.faceTracker.onResults((res) => {
                            clearTimeout(timer);
                            if (res.multiFaceLandmarks && res.multiFaceLandmarks.length > 0) {
                                const f = res.multiFaceLandmarks[0];
                                detected["forehead"] = [f[10].x, f[10].y];
                                detected["chin"] = [f[152].x, f[152].y];
                                detected["left_eye"] = [f[33].x, f[33].y];
                                detected["right_eye"] = [f[263].x, f[263].y];
                                if (!detected["nose"]) detected["nose"] = [f[1].x, f[1].y];
                            }
                            resolve();
                        });
                        this.faceTracker.send({ image: img }).catch(resolve);
                    });
                }

                this.detectedLandmarks = detected;
                const hasPose = ("left_shoulder" in detected);
                const hasFace = ("forehead" in detected || "left_eye" in detected);

                if (hasPose && hasFace) {
                    if (statusText) statusText.innerText = "تم كشف معالم الجسم والوجه بنجاح (MediaPipe AI)";
                    if (statusIndicator) statusIndicator.innerText = "🟢";
                } else if (hasFace) {
                    if (statusText) statusText.innerText = "تم كشف الوجه بنجاح (محاذاة الرأس نشطة)";
                    if (statusIndicator) statusIndicator.innerText = "🟡";
                } else if (hasPose) {
                    if (statusText) statusText.innerText = "تم كشف الأكتاف والجسم بنجاح";
                    if (statusIndicator) statusIndicator.innerText = "🟢";
                } else {
                    if (statusText) statusText.innerText = "استخدام المعايرة التلقائية لأبعاد الصورة";
                    if (statusIndicator) statusIndicator.innerText = "⚪";
                }

            } catch (err) {
                console.warn("Landmarks detection error:", err);
                if (statusText) statusText.innerText = "استخدام المعايرة التلقائية القياسية";
                if (statusIndicator) statusIndicator.innerText = "⚪";
            }
        };
        img.src = base64Data;
    }

    useCanvasImage() {
        if (this.app && this.app.canvas) {
            this.selectedModelBase64 = this.app.canvas.toDataURL("image/png");
            const thumb = document.getElementById("ptModelThumb");
            const placeholder = document.getElementById("ptModelPlaceholder");
            thumb.src = this.selectedModelBase64;
            thumb.style.display = "block";
            placeholder.style.display = "none";
            this.detectModelLandmarks(this.selectedModelBase64);
            this.app.showToast("تم جلب صورة الكانفاس الحالية بنجاح! 🖼️", "✨");
        }
    }

    handleModelUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            this.selectedModelBase64 = e.target.result;
            const thumb = document.getElementById("ptModelThumb");
            const placeholder = document.getElementById("ptModelPlaceholder");
            thumb.src = this.selectedModelBase64;
            thumb.style.display = "block";
            placeholder.style.display = "none";
            this.detectModelLandmarks(this.selectedModelBase64);
            this.app.showToast("تم تحميل صورة الموديل بنجاح! 👤", "✨");
        };
        reader.readAsDataURL(file);
    }

    rotateModelImage() {
        if (!this.selectedModelBase64) {
            this.app.showToast("يرجى اختيار صورة أولاً لتدويرها!", "⚠️");
            return;
        }
        const img = new Image();
        img.onload = () => {
            const rotCanvas = document.createElement("canvas");
            rotCanvas.width = img.height;
            rotCanvas.height = img.width;
            const ctx = rotCanvas.getContext("2d");
            ctx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
            ctx.rotate(90 * Math.PI / 180);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);

            this.selectedModelBase64 = rotCanvas.toDataURL("image/png");
            const thumb = document.getElementById("ptModelThumb");
            if (thumb) {
                thumb.src = this.selectedModelBase64;
                thumb.style.display = "block";
            }
            this.detectModelLandmarks(this.selectedModelBase64);
            this.app.showToast("تم تدوير الصورة 90 درجة بنجاح! ⟳", "✨");
        };
        img.src = this.selectedModelBase64;
    }

    handleGarmentUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            this.customGarmentBase64 = e.target.result;
            this.selectedGarmentId = "custom";
            this.app.showToast("تم رفع اللباس المخصص بنجاح! جاهز للتجربة 👔✨", "🎉");
            this.renderGarmentsGrid();
        };
        reader.readAsDataURL(file);
    }

    renderCategoryTabs() {
        const container = document.getElementById("ptCategoryTabs");
        if (!container || !this.catalog) return;
        container.innerHTML = "";

        const categoryOrder = ["suite", "maried", "cap", "glasses", "hair", "wishah", "mask", "graduition"];
        Object.keys(this.catalog).forEach(k => {
            if (!categoryOrder.includes(k)) categoryOrder.push(k);
        });

        categoryOrder.forEach(catKey => {
            const catData = this.catalog[catKey];
            if (!catData) return;
            const isActive = (this.currentCategory === catKey);
            const btn = document.createElement("button");
            btn.className = `ps-btn pt-tab-btn ${isActive ? 'active' : ''}`;
            btn.setAttribute("data-cat", catKey);
            btn.style.cssText = `font-size:11px; padding:5px 12px; border-radius:6px; white-space:nowrap; cursor:pointer; background:${isActive ? 'rgba(168,85,247,0.35)' : 'rgba(255,255,255,0.06)'}; border-color:${isActive ? '#a855f7' : 'transparent'}; color:${isActive ? '#fff' : '#94a3b8'}; transition:all 0.2s;`;
            btn.innerHTML = `${catData.icon || '✨'} ${catData.title}`;
            btn.onclick = () => this.selectCategory(catKey);
            container.appendChild(btn);
        });
    }

    selectCategory(cat) {
        this.currentCategory = cat;
        this.renderCategoryTabs();

        const scaleSlider = document.getElementById("ptScaleSlider");
        const scaleVal = document.getElementById("ptScaleVal");
        const agnosticCheck = document.getElementById("ptAgnosticCheck");
        const tpsCheck = document.getElementById("ptTpsCheck");

        if (cat === "hair" || cat === "glasses" || cat === "cap" || cat === "graduition" || cat === "mask") {
            if (agnosticCheck) agnosticCheck.checked = false;
            if (tpsCheck) tpsCheck.checked = false;
            if (scaleSlider) {
                scaleSlider.value = 1.0;
                if (scaleVal) scaleVal.innerText = "100%";
            }
        } else if (cat === "wishah") {
            if (agnosticCheck) agnosticCheck.checked = false;
            if (tpsCheck) tpsCheck.checked = false;
            if (scaleSlider) {
                scaleSlider.value = 1.2;
                if (scaleVal) scaleVal.innerText = "120%";
            }
        } else if (cat === "maried") {
            if (agnosticCheck) agnosticCheck.checked = false;
            if (tpsCheck) tpsCheck.checked = false;
            if (scaleSlider) {
                scaleSlider.value = 1.0;
                if (scaleVal) scaleVal.innerText = "100%";
            }
        } else {
            // suite
            if (agnosticCheck) agnosticCheck.checked = true;
            if (tpsCheck) tpsCheck.checked = true;
            if (scaleSlider) {
                scaleSlider.value = 1.68;
                if (scaleVal) scaleVal.innerText = "168%";
            }
        }

        this.renderGarmentsGrid();
    }

    renderGarmentsGrid() {
        const grid = document.getElementById("ptGarmentsGrid");
        if (!grid) return;
        grid.innerHTML = "";

        // بطاقة اللباس المخصص إذا وُجد
        if (this.customGarmentBase64) {
            const card = document.createElement("div");
            card.style.cssText = `border:2px solid ${this.selectedGarmentId === 'custom' ? '#d946ef' : 'rgba(255,255,255,0.1)'}; background:rgba(217,70,239,0.1); border-radius:8px; padding:6px; cursor:pointer; text-align:center; transition:all 0.2s;`;
            card.innerHTML = `
                <div style="height:95px; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                    <img src="${this.customGarmentBase64}" style="max-height:100%; max-width:100%; object-fit:contain;">
                </div>
                <span style="display:block; font-size:10px; color:#f0abfc; margin-top:4px; font-weight:bold;">لباسك الخاص ★</span>
            `;
            card.onclick = () => {
                this.selectedGarmentId = "custom";
                this.renderGarmentsGrid();
            };
            grid.appendChild(card);
        }

        if (!this.catalog || !this.catalog[this.currentCategory]) return;
        const items = this.catalog[this.currentCategory].items || [];

        items.forEach(item => {
            const isSelected = (this.selectedGarmentId === item.id);
            const card = document.createElement("div");
            card.style.cssText = `border:2px solid ${isSelected ? '#a855f7' : 'rgba(255,255,255,0.08)'}; background:${isSelected ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.03)'}; border-radius:8px; padding:6px; cursor:pointer; text-align:center; transition:all 0.2s;`;
            card.innerHTML = `
                <div style="height:95px; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                    <img src="${item.url}" style="max-height:100%; max-width:100%; object-fit:contain;">
                </div>
                <span style="display:block; font-size:10px; color:#cbd5e1; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${item.title}">${item.title}</span>
            `;
            card.onclick = () => {
                this.selectedGarmentId = item.id;
                this.renderGarmentsGrid();
            };
            grid.appendChild(card);
        });
    }

    async runTryOn() {
        if (!this.selectedModelBase64) {
            this.app.showToast("يرجى اختيار صورة الشخص أولاً!", "⚠️");
            return;
        }

        const spinner = document.getElementById("ptSpinner");
        const resImg = document.getElementById("ptResultImg");
        const placeholder = document.getElementById("ptResultPlaceholder");
        const btnAddLayer = document.getElementById("ptBtnAddLayer");
        const btnDownload = document.getElementById("ptBtnDownload");

        spinner.style.display = "flex";

        const scale = parseFloat(document.getElementById("ptScaleSlider").value);
        const offsetY = parseFloat(document.getElementById("ptOffsetSlider").value);
        const offsetX = parseFloat(document.getElementById("ptOffsetXSlider") ? document.getElementById("ptOffsetXSlider").value : 0);
        const useAgnostic = document.getElementById("ptAgnosticCheck").checked;
        const useTps = document.getElementById("ptTpsCheck").checked;

        const payload = {
            model_image: this.selectedModelBase64,
            garment_id: (this.selectedGarmentId !== "custom") ? this.selectedGarmentId : null,
            garment_image: (this.selectedGarmentId === "custom") ? this.customGarmentBase64 : null,
            category: this.currentCategory,
            landmarks: this.detectedLandmarks || {},
            options: {
                category: this.currentCategory,
                scale: scale,
                offset_y: offsetY,
                offset_x: offsetX,
                use_tps: useTps,
                neutralize_torso: useAgnostic
            }
        };

        try {
            const resp = await fetch("/api/photo_tryon", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await resp.json();
            spinner.style.display = "none";

            if (data.status === "success" && data.image) {
                this.resultBase64 = data.image;
                resImg.src = this.resultBase64;
                resImg.style.display = "block";
                placeholder.style.display = "none";

                btnAddLayer.disabled = false;
                btnDownload.disabled = false;

                this.app.showToast("تم توليد التجربة الافتراضية بنجاح! 👗✨", "🎉");
            } else {
                throw new Error(data.message || "فشلت المعالجة");
            }

        } catch (e) {
            spinner.style.display = "none";
            console.error("Photo tryon error:", e);
            this.app.showToast(`خطأ أثناء المعالجة: ${e.message}`, "❌");
        }
    }

    addAsLayer() {
        if (!this.resultBase64) return;
        this.app.commitNewBaseImage(this.resultBase64);
        this.close();
        this.app.showToast("تم إدراج النتيجة كطبقة عمل أساسية في الاستوديو بنجاح! 🎨", "✨");
    }

    downloadResult() {
        if (!this.resultBase64) return;
        const a = document.createElement("a");
        a.href = this.resultBase64;
        a.download = `VisionCraft_TryOn_${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        this.app.showToast("تم تنزيل الصورة بنجاح! 💾", "✅");
    }
}

// Global helper initialization
window.photoTryonStudio = null;
let photoTryonStudio = null;
window.addEventListener("DOMContentLoaded", () => {
    if (window.app) {
        window.photoTryonStudio = new PhotoTryonStudio(window.app);
        photoTryonStudio = window.photoTryonStudio;
    }
});

