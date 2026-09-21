/**
 * ==============================================================================
 * VisionCraft Studio - Full AR Smart Mirror Studio Engine (غرفة المراية الافتراضية)
 * ==============================================================================
 * 1. Live 60 FPS Full-Screen Mirrored Camera View
 * 2. Spatial Shelves & Vertical Drawers (أرفف مكانية وقوائم صفوف منبثقة لـ imagesthings)
 *    - 👔 البدلات الرسمية (suite) - 11 بدلة
 *    - 👰 أزياء المناسبات والأعراس (maried) - 10 أزياء
 *    - 👓 النظارات الشمسية والطبية (glasses) - 8 نظارات
 *    - 🧣 الأوشحة والسكارفات (wishah) - 10 أوشحة
 *    - 💇 قصات الشعر العصرية (hair) - 3 تسريحات
 * 3. Spatial Hand Reach Detection (كشف وصول اليد الفضائي للرفوف):
 *    - عند مد اليد إلى الجانب الأيمن أو الأيسر من الشاشة تنبثق القائمة فوراً
 * 4. Anatomical Torso Segmentation & Body-Fitting (تطابق البدلة الطبيعي واللاصق بالجذع):
 *    - محاذاة ياقة البدلة بدقة مع منخفض الرقبة Suprasternal Notch / Neck Base
 *    - تدوير وتمديد البدلة هندسياً مع انحناء الأكتاف وزاوية الجذع
 *    - ملاءمة محيط الصدر والخصر مع نقاط الوركين
 * 5. Anthropometric Depth Estimation (تقدير العمق الفيزيائي للوجه والجسم)
 * 6. Physics Snap-to-Fit (الارتداء التلقائي عبر حقول الجاذبية الافتراضية)
 * ==============================================================================
 */

/**
 * ==============================================================================
 * Modular AR Architecture (تم تقسيم الوحدات البرمجية وفصل الاهتمامات)
 * ==============================================================================
 * - Catalog Manager: web/js/ar/ar_catalog.js
 * - Geometric Fitting Engine: web/js/ar/ar_fitting.js
 * - UI & Drawing Manager: web/js/ar/ar_ui.js
 * ==============================================================================
 */
const DEFAULT_CATALOG = (typeof window !== 'undefined' && window.DEFAULT_CATALOG) ? window.DEFAULT_CATALOG : {};


class ARMirrorStudio {
    constructor(appInstance, gestureControllerInstance) {
        this.app = appInstance;
        this.gestureController = gestureControllerInstance;
        this.isActive = false;

        // Container & Canvas elements
        this.mirrorContainer = null;
        this.mirrorCanvas = null;
        this.ctx = null;
        this.videoElement = null;

        // Animation loop handle
        this.animFrameId = null;

        // MediaPipe Engines
        this.faceMesh = null;
        this.pose = null;
        this.hands = null;
        this.camera = null;
        this.mediaStream = null;
        this.localDetectionLoopId = null;
        // Camera Source: Local Webcam or Mobile IP Webcam
        this.cameraSource = localStorage.getItem("visioncraft_cam_source") || "ipcam"; // نفضل كاميرا الجوال بعد أن طلبها المستخدم
        this.ipCamUrl = localStorage.getItem("visioncraft_ipcam_url") || "http://192.168.8.106:8080/video";
        this.ipCamImg = null;
        this.ipCamLoopId = null;

        // Register globally
        window.arMirrorStudio = this;
        arMirrorStudio = this;

        // Anthropometric Calibration Constants
        this.HUMAN_IPD_CM = 6.3;          // متوسط المسافة بين بؤبؤي العينين (6.3 سم)
        this.HUMAN_SHOULDER_CM = 40.0;     // متوسط المسافة الحقيقية بين الأكتاف (40 سم)
        this.FOCAL_RATIO = 0.85;           // المعامل البؤري لكاميرات الويب

        // Live Tracking State
        this.faceLandmarks = null;
        this.poseLandmarks = null;
        this.handLandmarksList = [];
        this.depthMetrics = {
            faceDepthCm: 60.0,
            bodyDepthCm: 110.0,
            ipdPixels: 75.0,
            shoulderPixels: 220.0
        };

        // مرشح التنعيم اللحظي ومكافحة الاهتزاز (EMA Jitter Reduction Filter)
        this.smoothed = {
            suit: { neckX: null, neckY: null, w: null, angle: null },
            glasses: { cx: null, cy: null, w: null, angle: null },
            cap: { fx: null, fy: null, w: null, angle: null },
            hair: { fx: null, fy: null, w: null, angle: null },
            mask: { cx: null, cy: null, w: null, angle: null },
            scarf: { cx: null, cy: null, w: null },
            hand: { x: null, y: null }
        };

        // Hand Cursor & Dragging
        this.handCursor = { x: 0, y: 0, isPinching: false, isHolding: false, isVisible: false };
        this.draggedItem = null;

        // Worn Accessories (الأكسسوارات المرتداة حالياً على المستخدم)
        this.wornItems = {
            glasses: null,
            cap: null,
            hair: null,
            mask: null,
            scarf: null,
            suit: null,
            maried: null,
            graduition: null
        };

        // إعدادات مقاس وموضع البدلة (Fine-Tuning Controls)
        this.suitScaleMultiplier = 1.65; // معامل التكبير الطبيعي لتغطية كامل عرض الكتفين والذراعين
        this.suitOffsetShiftY = 0;      // إزاحة عمودية دقيقة لياقة البدلة (بالبكسل)

        // إظهار شبكة نقاط ومعالم الوجه واليدين والأصابع
        this.showLandmarks = true;

        // الكتالوج المدمج مباشرة لضمان العمل الفوري 100%
        this.catalog = DEFAULT_CATALOG;
        this.assets = {};
        this.openDrawer = null; // اسم الرف المفتوح حالياً
        this.drawerScrollY = 0;

        // فئات الأرفف الجانبية (8 فئات مدروسة وموزعة بانتظام)
        this.shelfCategories = [
            // الأرفف اليسرى (Left Shelves)
            { id: "glasses", title: "رف النظارات", icon: "👓", shelf: "left", y: 70, count: 8 },
            { id: "cap", title: "الكوافي والقبعات", icon: "🧢", shelf: "left", y: 132, count: 5 },
            { id: "hair", title: "قصات الشعر", icon: "💇", shelf: "left", y: 194, count: 4 },
            { id: "mask", title: "الأقنعة والكمامات", icon: "😷", shelf: "left", y: 256, count: 3 },
            
            // الأرفف اليمنى (Right Racks)
            { id: "suite", title: "علاقة البدلات", icon: "👔", shelf: "right", y: 70, count: 11 },
            { id: "maried", title: "أزياء المناسبات", icon: "👰", shelf: "right", y: 132, count: 10 },
            { id: "wishah", title: "رف الأوشحة", icon: "🧣", shelf: "right", y: 194, count: 10 },
            { id: "graduition", title: "أزياء التخرج", icon: "🎓", shelf: "right", y: 256, count: 2 }
        ];

        this.preloadCatalogAssets();
        this.fetchServerCatalog();
        this.initDOM();
    }

    async fetchServerCatalog() {
        try {
            const resp = await fetch("/api/catalog");
            if (resp.ok) {
                const data = await resp.json();
                if (data && Object.keys(data).length > 0) {
                    this.catalog = data;
                    this.preloadCatalogAssets();
                }
            }
        } catch (e) {
            console.warn("Could not fetch /api/catalog in ARMirrorStudio:", e);
        }
    }

    /**
     * دالة تنعيم حركة الإحداثيات الأساسية
     */
    smooth(current, target, alpha = 0.75) {
        if (current === null || current === undefined || isNaN(current)) return target;
        return current * alpha + target * (1.0 - alpha);
    }

    /**
     * دالة تنعيم الحركة المتكيفة الذكية (Adaptive EMA Jitter Filter):
     * - عند السكون أو الحركة الدقيقة: رفع معامل التنعيم (0.88) للقضاء التام على ارتعاش واهتزاز الكاميرا
     * - عند الحركة السريعة أو النقل: خفض معامل التنعيم (0.45) لاستجابة فورية فائقة السرعة بدون أي تأخير
     */
    smoothAdaptive(current, target, minAlpha = 0.45, maxAlpha = 0.88, threshold = 8.0) {
        if (current === null || current === undefined || isNaN(current)) return target;
        const diff = Math.abs(target - current);
        const factor = Math.min(1.0, diff / threshold);
        const alpha = maxAlpha - factor * (maxAlpha - minAlpha);
        return current * alpha + target * (1.0 - alpha);
    }

    /**
     * تنعيم الزوايا المتكيف مع معالجة الانتقال الدوري (-PI إلى +PI)
     */
    smoothAngleAdaptive(current, target, minAlpha = 0.50, maxAlpha = 0.88, threshold = 0.15) {
        if (current === null || current === undefined || isNaN(current)) return target;
        let diff = target - current;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const factor = Math.min(1.0, Math.abs(diff) / threshold);
        const alpha = maxAlpha - factor * (maxAlpha - minAlpha);
        return current + diff * (1.0 - alpha);
    }

    preloadCatalogAssets() {
        if (!this.catalog) return;
        Object.keys(this.catalog).forEach(catKey => {
            const cat = this.catalog[catKey];
            if (cat && cat.items) {
                cat.items.forEach(item => {
                    const img = new Image();
                    img.src = item.url;
                    this.assets[item.id] = img;
                });
            }
        });
    }

    initDOM() {
        this.mirrorContainer = document.getElementById("arMirrorContainer");
        this.mirrorCanvas = document.getElementById("arMirrorCanvas");
        if (this.mirrorCanvas) {
            this.ctx = this.mirrorCanvas.getContext("2d");
            this.bindMouseEvents();
        }
        this.videoElement = document.getElementById("arMirrorVideo") || document.getElementById("gestureVideo");
    }

    bindMouseEvents() {
        if (!this.mirrorCanvas || this._mouseBound) return;
        this._mouseBound = true;

        this.mirrorCanvas.addEventListener("mousedown", (e) => {
            if (!this.isActive) return;
            const rect = this.mirrorCanvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            this.handCursor.x = mx;
            this.handCursor.y = my;
            this.handCursor.isPinching = true;
            this.handCursor.isVisible = true;

            this.handlePointerDown(mx, my);
        });

        window.addEventListener("mousemove", (e) => {
            if (!this.isActive) return;
            const rect = this.mirrorCanvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            this.handCursor.x = mx;
            this.handCursor.y = my;
            this.handCursor.isVisible = true;

            this.handleSpatialReach(mx, my);

            if (this.draggedItem) {
                this.checkGravitationalSnap(this.draggedItem);
            }
        });

        window.addEventListener("mouseup", () => {
            if (!this.isActive) return;
            this.handCursor.isPinching = false;
            if (this.draggedItem) {
                this.checkGravitationalSnap(this.draggedItem);
                this.draggedItem = null;
                this.handCursor.isHolding = false;
            }
        });

        this.mirrorCanvas.addEventListener("wheel", (e) => {
            if (!this.isActive || !this.openDrawer) return;
            e.preventDefault();
            this.drawerScrollY += e.deltaY * 0.6;
            this.clampDrawerScroll();
        }, { passive: false });

        // اختصارات لوحة المفاتيح لتكبير/تصغير ورفع/خفض البدلة في الوقت الفعلي
        window.addEventListener("keydown", (e) => {
            if (!this.isActive) return;
            if (this.wornItems.suit) {
                if (e.key === "+" || e.key === "=" || e.key === "]") {
                    this.suitScaleMultiplier = Math.min(2.5, Math.round(((this.suitScaleMultiplier || 1.65) + 0.05) * 100) / 100);
                    this.app.showToast(`مقاس البدلة: ${Math.round(this.suitScaleMultiplier * 100)}% 👔`, "✨");
                } else if (e.key === "-" || e.key === "_" || e.key === "[") {
                    this.suitScaleMultiplier = Math.max(1.1, Math.round(((this.suitScaleMultiplier || 1.65) - 0.05) * 100) / 100);
                    this.app.showToast(`مقاس البدلة: ${Math.round(this.suitScaleMultiplier * 100)}% 👔`, "✨");
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    this.suitOffsetShiftY = (this.suitOffsetShiftY || 0) - 5;
                    this.app.showToast(`موضع الياقة: ${this.suitOffsetShiftY > 0 ? '+' : ''}${this.suitOffsetShiftY}px`, "⬆️");
                } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    this.suitOffsetShiftY = (this.suitOffsetShiftY || 0) + 5;
                    this.app.showToast(`موضع الياقة: ${this.suitOffsetShiftY > 0 ? '+' : ''}${this.suitOffsetShiftY}px`, "⬇️");
                } else if (e.key === "0") {
                    this.suitScaleMultiplier = 1.65;
                    this.suitOffsetShiftY = 0;
                    this.app.showToast("تمت إعادة ضبط مقاس البدلة للافتراضي (165%) ✨", "🔄");
                }
            }
        });
    }

    clampDrawerScroll() {
        if (!this.catalog || !this.openDrawer || !this.catalog[this.openDrawer]) return;
        const itemsCount = this.catalog[this.openDrawer].items.length;
        const maxScroll = Math.max(0, itemsCount * 70 - 320);
        this.drawerScrollY = Math.max(0, Math.min(this.drawerScrollY, maxScroll));
    }

    /**
     * كشف وصول اليد الفضائي للأرفف (Spatial Hand Reach Detection)
     * عندما تقترب يد المستخدم أو مؤشر الفأرة من الجهة اليمنى أو اليسرى تنبثق القائمة فوراً
     */
    handleSpatialReach(x, y) {
        if (!this.mirrorCanvas) return;
        const w = this.mirrorCanvas.width;
        const h = this.mirrorCanvas.height;

        if (this.draggedItem) return;

        // 1. وصول اليد إلى الجانب الأيمن (علاقة البدلات وأزياء المناسبات والأوشحة والتخرج)
        if (x > w - 260) {
            if (y < 125) {
                if (this.openDrawer !== "suite") {
                    this.openDrawer = "suite";
                    this.drawerScrollY = 0;
                    this.app.showToast("انفتحت علاقة البدلات الرسمية 👔", "🪞");
                }
            } else if (y < 190) {
                if (this.openDrawer !== "maried") {
                    this.openDrawer = "maried";
                    this.drawerScrollY = 0;
                    this.app.showToast("انفتحت علاقة أزياء المناسبات والأعراس 👰", "🪞");
                }
            } else if (y < 255) {
                if (this.openDrawer !== "wishah") {
                    this.openDrawer = "wishah";
                    this.drawerScrollY = 0;
                    this.app.showToast("انفتح رف الأوشحة والسكارفات 🧣", "🪞");
                }
            } else {
                if (this.openDrawer !== "graduition") {
                    this.openDrawer = "graduition";
                    this.drawerScrollY = 0;
                    this.app.showToast("انفتح قسم أزياء وقبعات التخرج 🎓", "🪞");
                }
            }
            return;
        }

        // 2. وصول اليد إلى الجانب الأيسر (النظارات، الكوافي، قصات الشعر، الكمامات)
        if (x < 260) {
            if (y < 125) {
                if (this.openDrawer !== "glasses") {
                    this.openDrawer = "glasses";
                    this.drawerScrollY = 0;
                    this.app.showToast("انفتح رف النظارات 👓", "🪞");
                }
            } else if (y < 190) {
                if (this.openDrawer !== "cap") {
                    this.openDrawer = "cap";
                    this.drawerScrollY = 0;
                    this.app.showToast("انفتح رف الكوافي والقبعات 🧢", "🪞");
                }
            } else if (y < 255) {
                if (this.openDrawer !== "hair") {
                    this.openDrawer = "hair";
                    this.drawerScrollY = 0;
                    this.app.showToast("انفتح رف قصات الشعر 💇", "🪞");
                }
            } else {
                if (this.openDrawer !== "mask") {
                    this.openDrawer = "mask";
                    this.drawerScrollY = 0;
                    this.app.showToast("انفتح رف الأقنعة والكمامات 😷", "🪞");
                }
            }
            return;
        }
    }

    handlePointerDown(mx, my) {
        const w = this.mirrorCanvas.width;

        // 0. فحص النقر على زر تبديل إظهار معالم الوجه والأيدي
        const hudX = w / 2 - 275;
        const hudY = 18;
        const hudW = 550;
        const hudH = 50;
        const badgeX = hudX + hudW - 195;
        const badgeY = hudY + 10;
        const badgeW = 180;
        const badgeH = 30;

        if (mx >= badgeX && mx <= badgeX + badgeW && my >= badgeY && my <= badgeY + badgeH) {
            this.showLandmarks = !this.showLandmarks;
            const msg = this.showLandmarks ? "تم تفعيل شبكة نقاط الوجه واليدين والأصابع ✨" : "تم إخفاء شبكة النقاط";
            this.app.showToast(msg, "👁️");
            return;
        }

        // 0.5 فحص النقر على شريط أزرار ضبط البدلة
        if (this.wornItems.suit) {
            const barW = 550;
            const barX = w / 2 - barW / 2;
            const barY = hudY + hudH + 10;

            if (my >= barY + 6 && my <= barY + 34) {
                const btnMinusX = barX + 95;
                const btnMinusW = 60;
                const btnPlusX = btnMinusX + btnMinusW + 50;
                const btnPlusW = 60;
                const btnUpX = btnPlusX + btnPlusW + 15;
                const btnUpW = 52;
                const btnDownX = btnUpX + btnUpW + 6;
                const btnDownW = 52;
                const btnResetX = btnDownX + btnDownW + 8;
                const btnResetW = 60;

                if (mx >= btnMinusX && mx <= btnMinusX + btnMinusW) {
                    this.suitScaleMultiplier = Math.max(1.10, Math.round(((this.suitScaleMultiplier || 1.65) - 0.05) * 100) / 100);
                    this.app.showToast(`مقاس البدلة: ${Math.round(this.suitScaleMultiplier * 100)}% 👔`, "✨");
                    return;
                }
                if (mx >= btnPlusX && mx <= btnPlusX + btnPlusW) {
                    this.suitScaleMultiplier = Math.min(2.50, Math.round(((this.suitScaleMultiplier || 1.65) + 0.05) * 100) / 100);
                    this.app.showToast(`مقاس البدلة: ${Math.round(this.suitScaleMultiplier * 100)}% 👔`, "✨");
                    return;
                }
                if (mx >= btnUpX && mx <= btnUpX + btnUpW) {
                    this.suitOffsetShiftY = (this.suitOffsetShiftY || 0) - 5;
                    this.app.showToast(`موضع الياقة: ${this.suitOffsetShiftY > 0 ? '+' : ''}${this.suitOffsetShiftY}px`, "⬆️");
                    return;
                }
                if (mx >= btnDownX && mx <= btnDownX + btnDownW) {
                    this.suitOffsetShiftY = (this.suitOffsetShiftY || 0) + 5;
                    this.app.showToast(`موضع الياقة: ${this.suitOffsetShiftY > 0 ? '+' : ''}${this.suitOffsetShiftY}px`, "⬇️");
                    return;
                }
                if (mx >= btnResetX && mx <= btnResetX + btnResetW) {
                    this.suitScaleMultiplier = 1.65;
                    this.suitOffsetShiftY = 0;
                    this.app.showToast("تمت إعادة ضبط مقاس البدلة للافتراضي (165%) ✨", "🔄");
                    return;
                }
            }
        }

        // 1. الضغط المباشر على أزرار الفئات
        for (let shelf of this.shelfCategories) {
            const sx = shelf.shelf === "left" ? 25 : (w - 175);
            const sy = shelf.y;
            const sw = shelf.shelf === "left" ? 140 : 150;
            const sh = 65;

            if (mx >= sx && mx <= sx + sw && my >= sy && my <= sy + sh) {
                this.openDrawer = (this.openDrawer === shelf.id) ? null : shelf.id;
                this.drawerScrollY = 0;
                if (this.openDrawer) {
                    this.app.showToast(`تم فتح ${shelf.title}! 👗✨`, "🗄️");
                }
                return;
            }
        }

        // 2. فحص الضغط على أي صف من صفوف القائمة المنبثقة
        if (this.openDrawer && this.catalog && this.catalog[this.openDrawer]) {
            const cat = this.catalog[this.openDrawer];
            const isLeft = (cat.shelf === "left");
            const drawerX = isLeft ? 175 : (w - 440);
            const drawerY = 80;
            const drawerW = 250;
            const drawerH = 430;

            // زر إغلاق الرف ✕
            if (mx >= drawerX + drawerW - 35 && mx <= drawerX + drawerW - 5 && my >= drawerY + 5 && my <= drawerY + 35) {
                this.openDrawer = null;
                return;
            }

            // فحص الصفوف
            if (mx >= drawerX && mx <= drawerX + drawerW && my >= drawerY + 45 && my <= drawerY + drawerH) {
                const relativeY = (my - (drawerY + 45)) + this.drawerScrollY;
                const itemIndex = Math.floor(relativeY / 70);
                if (itemIndex >= 0 && itemIndex < cat.items.length) {
                    const selectedItem = cat.items[itemIndex];
                    const catId = selectedItem.category || this.openDrawer;
                    if (catId === "suite") {
                        this.wornItems.suit = selectedItem;
                        this.app.showToast(`تم ارتداء ${selectedItem.title} على الجذع! 👔✨`, "🎉");
                    } else if (catId === "maried") {
                        this.wornItems.maried = selectedItem;
                        this.app.showToast(`تم ارتداء ${selectedItem.title} على الجذع! 👰✨`, "🎉");
                    } else if (catId === "glasses") {
                        this.wornItems.glasses = selectedItem;
                        this.app.showToast(`تم ارتداء ${selectedItem.title} وتطابقها على العينين! 👓✨`, "🎉");
                    } else if (catId === "hair") {
                        this.wornItems.hair = selectedItem;
                        this.app.showToast(`تم تطبيق ${selectedItem.title} على الرأس! 💇✨`, "🎉");
                    } else if (catId === "cap") {
                        this.wornItems.cap = selectedItem;
                        this.app.showToast(`تم ارتداء ${selectedItem.title} على أعلى الرأس! 🧢✨`, "🎉");
                    } else if (catId === "mask") {
                        this.wornItems.mask = selectedItem;
                        this.app.showToast(`تم ارتداء ${selectedItem.title} على الوجه! 😷✨`, "🎉");
                    } else if (catId === "wishah") {
                        this.wornItems.scarf = selectedItem;
                        this.app.showToast(`تم ارتداء ${selectedItem.title} على الرقبة! 🧣✨`, "🎉");
                    } else if (catId === "graduition") {
                        this.wornItems.graduition = selectedItem;
                        this.app.showToast(`تم ارتداء ${selectedItem.title}! 🎓✨`, "🎉");
                    }
                    this.draggedItem = selectedItem;
                    this.handCursor.isHolding = true;
                    return;
                }
            }
        }
    }

    async open() {
        if (this.isActive) return;
        const gesture = window.gestureController || (typeof gestureController !== "undefined" ? gestureController : null);
        if (gesture && gesture.isEnabled) {
            try { gesture.stop(); } catch(e) {}
        }
        this.initDOM();
        this.isActive = true;
        this.openDrawer = "suite"; // فتح علاقة البدلات تلقائياً عند الدخول لتكون الصفوف ظاهرة فوراً
        this.drawerScrollY = 0;

        if (this.mirrorContainer) {
            this.mirrorContainer.style.display = "flex";
        }

        this.resizeCanvas();
        window.addEventListener("resize", () => this.resizeCanvas());

        this.app.showToast("مرحباً بك في استوديو المراية الذكية! 🪞✨", "🪞");

        await this.initVisionPipelines();
        this.renderLoop();
    }

    close() {
        this.isActive = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        if (this.detectionLoopTimer) {
            cancelAnimationFrame(this.detectionLoopTimer);
            this.detectionLoopTimer = null;
        }
        if (this.localDetectionLoopId) {
            cancelAnimationFrame(this.localDetectionLoopId);
            this.localDetectionLoopId = null;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => {
                try { track.stop(); } catch(e) {}
            });
            this.mediaStream = null;
        }
        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }
        if (this.camera) {
            try { this.camera.stop(); } catch(e) {}
            this.camera = null;
        }
        if (this.ipCamLoopId) {
            cancelAnimationFrame(this.ipCamLoopId);
            this.ipCamLoopId = null;
        }
        if (this.ipCamImg) {
            this.ipCamImg.onload = null;
            this.ipCamImg.onerror = null;
            this.ipCamImg.src = "";
            this.ipCamImg = null;
        }
        if (this.mirrorContainer) {
            this.mirrorContainer.style.display = "none";
        }
        this.app.showToast("تم إغلاق غرفة المراية", "🚪");
    }

    resizeCanvas() {
        if (!this.mirrorCanvas) return;
        this.mirrorCanvas.width = window.innerWidth;
        this.mirrorCanvas.height = window.innerHeight;
    }

    async initVisionPipelines() {
        try {
            if (!this.videoElement) {
                this.videoElement = document.getElementById("arMirrorVideo") || document.getElementById("gestureVideo");
            }

            // 1. MediaPipe Face Mesh (تتبع ملامح الوجه والرأس بدقة وسرعة)
            if (!this.faceMesh && typeof FaceMesh !== "undefined") {
                this.faceMesh = new FaceMesh({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
                });
                this.faceMesh.setOptions({
                    maxNumFaces: 1,
                    refineLandmarks: true,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                this.faceMesh.onResults((res) => {
                    if (res.multiFaceLandmarks && res.multiFaceLandmarks.length > 0) {
                        this.faceLandmarks = res.multiFaceLandmarks[0];
                        this.computeFaceAnthropometricDepth();
                    } else {
                        this.faceLandmarks = null;
                    }
                });
            }

            // 2. MediaPipe Pose (تتبع الجذع والأكتاف)
            if (!this.pose && typeof Pose !== "undefined") {
                this.pose = new Pose({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
                });
                this.pose.setOptions({
                    modelComplexity: 0,
                    smoothLandmarks: true,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                this.pose.onResults((res) => {
                    if (res.poseLandmarks) {
                        this.poseLandmarks = res.poseLandmarks;
                        this.computeBodyAnthropometricDepth();
                    } else {
                        this.poseLandmarks = null;
                    }
                });
            }

            // 3. MediaPipe Hands (تتبع حركة اليدين والأصابع والإمساك)
            if (!this.hands && typeof Hands !== "undefined") {
                this.hands = new Hands({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
                });
                this.hands.setOptions({
                    maxNumHands: 2,
                    modelComplexity: 1,
                    minDetectionConfidence: 0.4,
                    minTrackingConfidence: 0.4
                });
                this.hands.onResults((res) => {
                    this.handLandmarksList = res.multiHandLandmarks || [];
                    this.processHandInteractions();
                });
            }

            // تشغيل الكاميرا (كاميرا الجوال IP Webcam أو كاميرا اللابتوب)
            if (this.cameraSource === "ipcam" && this.ipCamUrl) {
                this.startIpCameraStream(this.ipCamUrl);
            } else {
                await this.startLocalCamera();
            }

        } catch (err) {
            console.error("AR Mirror Pipeline initialization error:", err);
            this.app.showToast("خطأ في تشغيل الكاميرا للمراية: " + (err.message || err), "⚠️");
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

        // 1. Cancel any local detection loop and stop webcam streams
        if (this.localDetectionLoopId) {
            cancelAnimationFrame(this.localDetectionLoopId);
            this.localDetectionLoopId = null;
        }
        if (this.mediaStream) {
            try {
                this.mediaStream.getTracks().forEach(track => track.stop());
            } catch(e) {}
            this.mediaStream = null;
        }
        if (this.videoElement && this.videoElement.srcObject) {
            try {
                this.videoElement.srcObject.getTracks().forEach(track => track.stop());
            } catch(e) {}
            this.videoElement.srcObject = null;
        }
        if (this.camera) {
            try { this.camera.stop(); } catch(e) {}
            this.camera = null;
        }

        // 2. Clean up previous IP Cam stream
        if (this.ipCamLoopId) {
            cancelAnimationFrame(this.ipCamLoopId);
            this.ipCamLoopId = null;
        }

        if (this.ipCamImg) {
            this.ipCamImg.onload = null;
            this.ipCamImg.onerror = null;
            this.ipCamImg.src = "";
            this.ipCamImg = null;
        }

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        this.ipCamImg = img;

        let isProcessing = false;
        const processIpFrame = async () => {
            if (!this.isActive || this.cameraSource !== "ipcam") return;
            if (!isProcessing && this.ipCamImg && this.ipCamImg.naturalWidth > 0) {
                isProcessing = true;
                try {
                    if (this.hands) await this.hands.send({ image: this.ipCamImg });
                } catch(e) {}
                try {
                    if (this.faceMesh) await this.faceMesh.send({ image: this.ipCamImg });
                } catch(e) {}
                try {
                    if (this.pose) await this.pose.send({ image: this.ipCamImg });
                } catch(e) {}
                isProcessing = false;
            }
            this.ipCamLoopId = requestAnimationFrame(processIpFrame);
        };
        this.ipCamLoopId = requestAnimationFrame(processIpFrame);

        const btn = document.getElementById("btnMirrorCamSource");
        if (btn) {
            btn.innerHTML = "📱 كاميرا الجوال (متصلة)";
            btn.style.borderColor = "#10b981";
            btn.style.color = "#10b981";
        }
        const btnToggle = document.getElementById("btnMirrorCamToggle");
        if (btnToggle) {
            btnToggle.innerHTML = "💻 التبديل لكاميرا الكمبيوتر";
            btnToggle.style.borderColor = "#00e5ff";
            btnToggle.style.color = "#00e5ff";
        }
        this.app.showToast(`تم الاتصال بكاميرا الجوال (${url}) 📱✨`, "⚡");
    }

    async startLocalCamera() {
        this.cameraSource = "local";
        localStorage.setItem("visioncraft_cam_source", "local");

        // 1. Clean up IP camera stream and loops
        if (this.ipCamLoopId) {
            cancelAnimationFrame(this.ipCamLoopId);
            this.ipCamLoopId = null;
        }
        if (this.ipCamImg) {
            this.ipCamImg.onload = null;
            this.ipCamImg.onerror = null;
            this.ipCamImg.src = "";
            this.ipCamImg = null;
        }

        // 2. Clean up previous local streams and detection loops
        if (this.localDetectionLoopId) {
            cancelAnimationFrame(this.localDetectionLoopId);
            this.localDetectionLoopId = null;
        }
        if (this.mediaStream) {
            try {
                this.mediaStream.getTracks().forEach(track => track.stop());
            } catch(e) {}
            this.mediaStream = null;
        }
        if (this.camera) {
            try { this.camera.stop(); } catch(e) {}
            this.camera = null;
        }

        if (!this.videoElement) {
            this.videoElement = document.getElementById("arMirrorVideo") || document.getElementById("gestureVideo");
        }
        if (this.videoElement && this.videoElement.srcObject) {
            try {
                this.videoElement.srcObject.getTracks().forEach(track => track.stop());
            } catch(e) {}
            this.videoElement.srcObject = null;
        }

        // 3. Acquire webcam stream with progressive fallbacks (1080p/720p -> 480p -> generic)
        try {
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, facingMode: "user" },
                    audio: false
                });
            } catch (err1) {
                console.warn("HD camera request failed, trying 640x480:", err1);
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { width: 640, height: 480 },
                        audio: false
                    });
                } catch (err2) {
                    console.warn("640x480 camera request failed, trying basic video:", err2);
                    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                }
            }

            this.mediaStream = stream;

            if (this.videoElement) {
                this.videoElement.srcObject = stream;
                await new Promise((resolve) => {
                    let resolved = false;
                    const done = () => {
                        if (!resolved) {
                            resolved = true;
                            resolve();
                        }
                    };
                    const timer = setTimeout(done, 2500);
                    this.videoElement.onloadedmetadata = async () => {
                        try {
                            await this.videoElement.play();
                        } catch(e) {}
                        clearTimeout(timer);
                        done();
                    };
                    if (this.videoElement.readyState >= 2) {
                        this.videoElement.play().catch(() => {});
                        clearTimeout(timer);
                        done();
                    }
                });
                try { await this.videoElement.play(); } catch(e) {}
            }

            // 4. Start local frame detection loop for MediaPipe models
            this.startLocalDetectionLoop();

            const btn = document.getElementById("btnMirrorCamSource");
            if (btn) {
                btn.innerHTML = "💻 كاميرا الكمبيوتر (متصلة)";
                btn.style.borderColor = "#00e5ff";
                btn.style.color = "#00e5ff";
            }
            const btnToggle = document.getElementById("btnMirrorCamToggle");
            if (btnToggle) {
                btnToggle.innerHTML = "📱 التبديل لكاميرا الجوال";
                btnToggle.style.borderColor = "#10b981";
                btnToggle.style.color = "#10b981";
            }
            this.app.showToast("تم تفعيل كاميرا الكمبيوتر بنجاح! 💻✨", "📷");

        } catch (err) {
            console.error("Local camera activation error:", err);
            let msg = "تعذر تشغيل كاميرا الكمبيوتر.";
            if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
                msg = "تم رفض إذن الكاميرا. يرجى السماح بالوصول للكاميرا من إعدادات المتصفح.";
            } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
                msg = "كاميرا الكمبيوتر قيد الاستخدام من تطبيق آخر أو نافذة أخرى. يرجى إغلاق التطبيقات الأخرى.";
            } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
                msg = "لم يتم العثور على كاميرا ويب متصلة بالكمبيوتر.";
            }
            this.app.showToast(msg, "❌");
        }
    }

    startLocalDetectionLoop() {
        if (this.localDetectionLoopId) {
            cancelAnimationFrame(this.localDetectionLoopId);
            this.localDetectionLoopId = null;
        }
        let isDetecting = false;
        const detectFrame = async () => {
            if (!this.isActive || this.cameraSource !== "local") return;
            if (!isDetecting && this.videoElement && this.videoElement.readyState >= 2 && !this.videoElement.paused) {
                isDetecting = true;
                try {
                    if (this.hands) await this.hands.send({ image: this.videoElement });
                } catch(e) {}
                try {
                    if (this.faceMesh) await this.faceMesh.send({ image: this.videoElement });
                } catch(e) {}
                try {
                    if (this.pose) await this.pose.send({ image: this.videoElement });
                } catch(e) {}
                isDetecting = false;
            }
            this.localDetectionLoopId = requestAnimationFrame(detectFrame);
        };
        this.localDetectionLoopId = requestAnimationFrame(detectFrame);
    }

    async toggleCamSource() {
        if (this.cameraSource === "local") {
            this.startIpCameraStream(this.ipCamUrl);
        } else {
            await this.startLocalCamera();
        }
    }

    computeFaceAnthropometricDepth() {
        if (!this.faceLandmarks || !this.mirrorCanvas) return;
        const w = this.mirrorCanvas.width;
        const h = this.mirrorCanvas.height;

        const leftEyePt = this.faceLandmarks[468] || this.faceLandmarks[33];
        const rightEyePt = this.faceLandmarks[473] || this.faceLandmarks[263];

        const lx = (1.0 - leftEyePt.x) * w;
        const ly = leftEyePt.y * h;
        const rx = (1.0 - rightEyePt.x) * w;
        const ry = rightEyePt.y * h;

        const rawIpd = Math.hypot(rx - lx, ry - ly);
        if (rawIpd > 10) {
            const ipdPixels = this.smoothAdaptive(this.depthMetrics.ipdPixels, rawIpd, 0.50, 0.88, 5.0);
            const focalLength = w * this.FOCAL_RATIO;
            const depthCm = (focalLength * this.HUMAN_IPD_CM) / ipdPixels;
            this.depthMetrics.ipdPixels = ipdPixels;
            this.depthMetrics.faceDepthCm = Math.round(depthCm * 10) / 10;
        }
    }

    computeBodyAnthropometricDepth() {
        if (!this.poseLandmarks || !this.mirrorCanvas) return;
        const w = this.mirrorCanvas.width;
        const h = this.mirrorCanvas.height;

        const leftSh = this.poseLandmarks[11];
        const rightSh = this.poseLandmarks[12];

        if (leftSh && rightSh && leftSh.visibility > 0.35 && rightSh.visibility > 0.35) {
            const lsx = (1.0 - leftSh.x) * w;
            const lsy = leftSh.y * h;
            const rsx = (1.0 - rightSh.x) * w;
            const rsy = rightSh.y * h;

            const rawShoulders = Math.hypot(rsx - lsx, rsy - lsy);
            if (rawShoulders > 30) {
                const shoulderPixels = this.smoothAdaptive(this.depthMetrics.shoulderPixels, rawShoulders, 0.50, 0.88, 8.0);
                const focalLength = w * this.FOCAL_RATIO;
                const depthCm = (focalLength * this.HUMAN_SHOULDER_CM) / shoulderPixels;
                this.depthMetrics.shoulderPixels = shoulderPixels;
                this.depthMetrics.bodyDepthCm = Math.round(depthCm * 10) / 10;
            }
        }
    }

    getActiveHand() {
        if (!this.handLandmarksList || this.handLandmarksList.length === 0) return null;
        if (this.handLandmarksList.length === 1) return this.handLandmarksList[0];

        // اختيار اليد التفاعلية الذكية: نفضل اليد المرفوعة للأعلى أو التي تشير بالسبابة على اليد المستقرة في الأسفل
        let bestHand = this.handLandmarksList[0];
        let bestScore = -9999;

        for (let i = 0; i < this.handLandmarksList.length; i++) {
            const h = this.handLandmarksList[i];
            const wrist = h[0];
            const thumb = h[4];
            const index = h[8];
            const indexPip = h[6];
            const middle = h[12];
            const middlePip = h[10];

            let score = 0;
            // اليد المرتفعة نحو الشاشة (y أقل) تأخذ أولوية عليا
            score += (1.0 - wrist.y) * 120;
            score += (1.0 - index.y) * 80;

            // إذا كان إصبع السبابة مفروداً لأعلى (Pointing Finger)
            if (index.y < indexPip.y) {
                score += 150;
            }
            // إذا كانت السبابة وحدها مفرودة وبقية الأصابع مقبوضة
            if (index.y < indexPip.y && middle.y > middlePip.y) {
                score += 200;
            }
            // إذا كانت تقوم بالقرص (Pinch)
            const pDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
            if (pDist < 0.08) {
                score += 120;
            }

            if (score > bestScore) {
                bestScore = score;
                bestHand = h;
            }
        }
        return bestHand;
    }

    processHandInteractions() {
        if (!this.handLandmarksList || this.handLandmarksList.length === 0 || !this.mirrorCanvas) {
            this.handCursor.isHolding = false;
            this.handCursor.isVisible = false;
            return;
        }

        const w = this.mirrorCanvas.width;
        const h = this.mirrorCanvas.height;
        const hand = this.getActiveHand();
        if (!hand) return;

        const thumb = hand[4];
        const index = hand[8];
        const indexPip = hand[6];
        const wrist = hand[0];
        const middleMcp = hand[9];

        const tx = (1.0 - thumb.x) * w;
        const ty = thumb.y * h;
        const ix = (1.0 - index.x) * w;
        const iy = index.y * h;

        // كشف إشارة السبابة المرفوعة (Pointing Gesture)
        const isPointing = (index.y < indexPip.y);
        this.handCursor.isPointing = isPointing;

        // أثناء الإشارة بالسبابة: يرتكز المؤشر بدقة 100% عند رأس إصبع السبابة (ix, iy)
        // وأثناء القرص: يرتكز عند نقطة التقاء الإبهام والسبابة
        const rawHandX = isPointing ? ix : ((tx + ix) / 2.0);
        const rawHandY = isPointing ? iy : ((ty + iy) / 2.0);

        // تنعيم متكيف لحظي لحركة اليد
        this.handCursor.x = this.smoothAdaptive(this.smoothed.hand.x, rawHandX, 0.45, 0.86, 8.0);
        this.handCursor.y = this.smoothAdaptive(this.smoothed.hand.y, rawHandY, 0.45, 0.86, 8.0);
        this.smoothed.hand.x = this.handCursor.x;
        this.smoothed.hand.y = this.handCursor.y;
        this.handCursor.isVisible = true;

        // 1. المعايرة النسبية بحجم الكف (Scale-Invariant Hand Ratio)
        const handScale = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y);
        const normDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
        const pinchRatio = normDist / Math.max(0.015, handScale);

        // 2. عتبة الاستقرار المزدوجة (Hysteresis Schmitt Trigger)
        const PINCH_GRAB_RATIO = 0.22;
        const PINCH_RELEASE_RATIO = 0.38;
        const wasPinching = this.handCursor.isPinching;

        const isPinchNow = this.draggedItem 
            ? (pinchRatio < PINCH_RELEASE_RATIO) 
            : (pinchRatio < PINCH_GRAB_RATIO);

        this.handCursor.isPinching = isPinchNow;

        // كشف وصول اليد للرفوف
        this.handleSpatialReach(this.handCursor.x, this.handCursor.y);

        // عند الإمساك باليد فوق عنصر من الرف
        if (!wasPinching && this.handCursor.isPinching && !this.draggedItem) {
            this.handlePointerDown(this.handCursor.x, this.handCursor.y);
            this.releaseFrames = 0;
        }

        // إذا كان المستخدم يحمل قطعة حالياً
        if (this.draggedItem) {
            if (this.handCursor.isPinching) {
                this.releaseFrames = 0;
                this.checkGravitationalSnap(this.draggedItem);
            } else {
                // مخزن أمان زمني (2 إطارات) لمنع السقوط العارض أثناء تحريك اليد
                this.releaseFrames = (this.releaseFrames || 0) + 1;
                if (this.releaseFrames >= 2) {
                    this.app.showToast(`تم إفلات ${this.draggedItem.title}`, "🔄");
                    this.draggedItem = null;
                    this.handCursor.isHolding = false;
                    this.releaseFrames = 0;
                }
            }
        }
    }

    checkGravitationalSnap(item) {
        const w = this.mirrorCanvas.width;
        const h = this.mirrorCanvas.height;
        const itemType = item.type || item.category;
        const cat = item.category || itemType;

        // 1. البدلات والملابس الرسمية (suite أو maried) -> جاذبية الصدر والأكتاف
        if (cat === "suite" || cat === "maried" || itemType === "suit") {
            let targetChestX = w / 2;
            let targetChestY = h * 0.52;

            if (this.poseLandmarks && this.poseLandmarks[11] && this.poseLandmarks[12]) {
                const lsx = (1.0 - this.poseLandmarks[11].x) * w;
                const rsx = (1.0 - this.poseLandmarks[12].x) * w;
                const lsy = this.poseLandmarks[11].y * h;
                const rsy = this.poseLandmarks[12].y * h;
                targetChestX = (lsx + rsx) / 2.0;
                targetChestY = (lsy + rsy) / 2.0 + 60;
            }

            const distToChest = Math.hypot(this.handCursor.x - targetChestX, this.handCursor.y - targetChestY);

            if (distToChest < 220) {
                if (cat === "maried") {
                    this.wornItems.maried = item;
                } else {
                    this.wornItems.suit = item;
                }
                this.app.showToast(`تم ارتداء ${item.title} بمطابقة مضلع الجذع والأكتاف! 👔✨`, "🎉");
                this.draggedItem = null;
                this.handCursor.isHolding = false;
            }
        }

        // 2. النظارات (glasses) -> جاذبية العينين والأنف
        else if (cat === "glasses") {
            if (this.faceLandmarks) {
                const nose = this.faceLandmarks[6] || this.faceLandmarks[1];
                const nx = (1.0 - nose.x) * w;
                const ny = nose.y * h;
                const distToFace = Math.hypot(this.handCursor.x - nx, this.handCursor.y - ny);

                if (distToFace < 160) {
                    this.wornItems.glasses = item;
                    this.app.showToast(`تم ارتداء ${item.title} وتطابقها على العينين! 👓✨`, "🎉");
                    this.draggedItem = null;
                    this.handCursor.isHolding = false;
                }
            }
        }

        // 3. الكوافي والقبعات (cap) -> جاذبية أعلى الرأس والجبين
        else if (cat === "cap") {
            if (this.faceLandmarks) {
                const forehead = this.faceLandmarks[10];
                const fx = (1.0 - forehead.x) * w;
                const fy = forehead.y * h - 40;
                const distToHead = Math.hypot(this.handCursor.x - fx, this.handCursor.y - fy);

                if (distToHead < 180) {
                    this.wornItems.cap = item;
                    this.app.showToast(`تم ارتداء ${item.title} على أعلى الرأس! 🧢✨`, "🎉");
                    this.draggedItem = null;
                    this.handCursor.isHolding = false;
                }
            }
        }

        // 4. قصات الشعر (hair) -> جاذبية خط منبت الشعر
        else if (cat === "hair") {
            if (this.faceLandmarks) {
                const forehead = this.faceLandmarks[10];
                const fx = (1.0 - forehead.x) * w;
                const fy = forehead.y * h;
                const distToHead = Math.hypot(this.handCursor.x - fx, this.handCursor.y - fy);

                if (distToHead < 170) {
                    this.wornItems.hair = item;
                    this.app.showToast(`تم تطبيق ${item.title} على الرأس بشكل صحيح! 💇✨`, "🎉");
                    this.draggedItem = null;
                    this.handCursor.isHolding = false;
                }
            }
        }

        // 5. الأقنعة والكمامات (mask) -> جاذبية الفم والأنف والذقن
        else if (cat === "mask") {
            if (this.faceLandmarks) {
                const chin = this.faceLandmarks[152];
                const nose = this.faceLandmarks[1];
                const mx = (1.0 - ((chin.x + nose.x) / 2)) * w;
                const my = ((chin.y + nose.y) / 2) * h;
                const distToMouth = Math.hypot(this.handCursor.x - mx, this.handCursor.y - my);

                if (distToMouth < 160) {
                    this.wornItems.mask = item;
                    this.app.showToast(`تم ارتداء ${item.title} على الوجه! 😷✨`, "🎉");
                    this.draggedItem = null;
                    this.handCursor.isHolding = false;
                }
            }
        }

        // 6. الأوشحة (wishah / scarf) -> جاذبية الرقبة والذقن
        else if (cat === "wishah" || itemType === "scarf") {
            if (this.faceLandmarks) {
                const chin = this.faceLandmarks[152];
                const cx = (1.0 - chin.x) * w;
                const cy = chin.y * h;
                const distToNeck = Math.hypot(this.handCursor.x - cx, this.handCursor.y - (cy + 35));

                if (distToNeck < 170) {
                    this.wornItems.scarf = item;
                    this.app.showToast(`تم ارتداء ${item.title} على الرقبة! 🧣✨`, "🎉");
                    this.draggedItem = null;
                    this.handCursor.isHolding = false;
                }
            }
        }

        // 7. أزياء وقبعات التخرج (graduition) -> جاذبية الرأس أو الصدر
        else if (cat === "graduition") {
            if (this.faceLandmarks) {
                const forehead = this.faceLandmarks[10];
                const fx = (1.0 - forehead.x) * w;
                const fy = forehead.y * h - 40;
                const distToHead = Math.hypot(this.handCursor.x - fx, this.handCursor.y - fy);

                if (distToHead < 190) {
                    this.wornItems.graduition = item;
                    this.app.showToast(`تم ارتداء ${item.title} للتخرج! 🎓✨`, "🎉");
                    this.draggedItem = null;
                    this.handCursor.isHolding = false;
                }
            }
        }
    }

    renderLoop() {
        if (!this.isActive) return;
        this.drawMirrorFrame();
        this.animFrameId = requestAnimationFrame(() => this.renderLoop());
    }

    drawMirrorFrame() {
        const ctx = this.ctx;
        if (!ctx || !this.mirrorCanvas) return;
        const w = this.mirrorCanvas.width;
        const h = this.mirrorCanvas.height;

        ctx.clearRect(0, 0, w, h);

        // 1. رسم تغذية الكاميرا بمرآة أفقية (كاميرا اللابتوب أو كاميرا الجوال IP Webcam)
        const isIp = (this.cameraSource === "ipcam");
        const sourceMedia = (isIp && this.ipCamImg && this.ipCamImg.naturalWidth > 0)
            ? this.ipCamImg
            : this.videoElement;

        const isMediaReady = isIp
            ? (this.ipCamImg && this.ipCamImg.naturalWidth > 0)
            : (this.videoElement && this.videoElement.readyState >= 2);

        if (isMediaReady && sourceMedia) {
            ctx.save();
            ctx.translate(w, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(sourceMedia, 0, 0, w, h);
            ctx.restore();
        } else {
            ctx.fillStyle = "#121520";
            ctx.fillRect(0, 0, w, h);
            ctx.save();
            ctx.textAlign = "center";
            if (isIp) {
                ctx.fillStyle = "#00e5ff";
                ctx.font = "bold 16px sans-serif";
                ctx.shadowColor = "#00e5ff";
                ctx.shadowBlur = 10;
                ctx.fillText("📱 جاري الاتصال بتدفق كاميرا الجوال: " + this.ipCamUrl, w / 2, h / 2);
                ctx.font = "12px sans-serif";
                ctx.fillStyle = "#94a3b8";
                ctx.fillText("تأكد أن تطبيق IP Webcam قيد التشغيل على هاتفك", w / 2, (h / 2) + 26);
            } else {
                ctx.fillStyle = "#00e5ff";
                ctx.font = "bold 16px sans-serif";
                ctx.shadowColor = "#00e5ff";
                ctx.shadowBlur = 10;
                ctx.fillText("💻 جاري تشغيل كاميرا الكمبيوتر...", w / 2, h / 2);
                ctx.font = "12px sans-serif";
                ctx.fillStyle = "#94a3b8";
                ctx.fillText("يرجى التأكد من السماح للمتصفح بالوصول إلى الكاميرا وعدم استخدامها في تطبيق آخر", w / 2, (h / 2) + 26);
            }
            ctx.restore();
        }

        // تدرج إضاءة المرآة المحيطة
        const gradient = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.85);
        gradient.addColorStop(0, "rgba(0, 229, 255, 0.0)");
        gradient.addColorStop(1, "rgba(10, 15, 26, 0.65)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);

        // 1.5 رسم شبكة ونقاط الوجه والجذع (Face Mesh & Pose Landmarks)
        if (this.showLandmarks) {
            this.renderFaceAndBodyLandmarks(ctx, w, h);
        }

        // 2. رسم الأكسسوارات المرتداة (البدلة بمطابقة مضلع الجذع، النظارات، الأوشحة)
        this.renderWornAccessories(ctx, w, h);

        // 2.5 رسم نقاط وهيكل اليدين والأصابع (Hand Landmarks & Finger Skeleton)
        if (this.showLandmarks) {
            this.renderHandAndFingerLandmarks(ctx, w, h);
        }

        // 3. رسم الأرفف والقوائم الرأسية المنبثقة
        this.renderSpatialShelves(ctx, w, h);

        // 4. رسم العنصر المسحوب باليد
        if (this.draggedItem) {
            this.renderDraggedItem(ctx);
        }

        // 5. رسم مؤشر اليد
        this.renderHandCursor(ctx);

        // 6. شريط القياسات الحيوية
        this.renderMetricsHUD(ctx, w, h);
    }

    renderSpatialShelves(ctx, w, h) {
        ctx.save();

        // 1. رسم أزرار الفئات الرئيسية على الجانبين
        this.shelfCategories.forEach(shelf => {
            const isLeft = (shelf.shelf === "left");
            const x = isLeft ? 25 : (w - 175);
            const y = shelf.y;
            const sw = isLeft ? 140 : 150;
            const sh = 65;

            const isOpen = (this.openDrawer === shelf.id);

            ctx.fillStyle = isOpen ? "rgba(20, 115, 230, 0.38)" : "rgba(18, 24, 38, 0.82)";
            ctx.strokeStyle = isOpen ? "#00dfd8" : (isLeft ? "rgba(0, 229, 255, 0.45)" : "rgba(255, 0, 127, 0.45)");
            ctx.lineWidth = isOpen ? 2.5 : 1.5;

            if (isOpen) {
                ctx.shadowColor = isLeft ? "#00e5ff" : "#ff007f";
                ctx.shadowBlur = 14;
            } else {
                ctx.shadowBlur = 0;
            }

            this.roundRect(ctx, x, y, sw, sh, 10, true, true);
            ctx.shadowBlur = 0;

            ctx.font = "22px Segoe UI, sans-serif";
            ctx.fillText(shelf.icon, x + 12, y + 42);

            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 12px Segoe UI, sans-serif";
            ctx.fillText(shelf.title, x + 44, y + 30);

            ctx.fillStyle = isLeft ? "#00e5ff" : "#ff007f";
            ctx.font = "bold 10px Fira Code, monospace";
            const itemCount = (this.catalog && this.catalog[shelf.id]) ? this.catalog[shelf.id].items.length : shelf.count;
            ctx.fillText(`[ ${itemCount} قطع ]`, x + 44, y + 48);
        });

        // 2. رسم القائمة الرأسية المنسدلة في صفوف فوق بعض
        if (this.openDrawer && this.catalog && this.catalog[this.openDrawer]) {
            this.renderDrawerList(ctx, w, h, this.openDrawer);
        }

        ctx.restore();
    }

    renderDrawerList(ctx, w, h, catId) {
        const cat = this.catalog[catId];
        if (!cat || !cat.items) return;

        const isLeft = (cat.shelf === "left");
        const drawerX = isLeft ? 175 : (w - 440);
        const drawerY = 80;
        const drawerW = 255;
        const drawerH = 430;

        ctx.save();

        // خلفية زجاجية أنيقة للقائمة
        ctx.fillStyle = "rgba(12, 18, 32, 0.94)";
        ctx.strokeStyle = isLeft ? "#00e5ff" : "#ff007f";
        ctx.lineWidth = 2.0;
        ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
        ctx.shadowBlur = 30;
        this.roundRect(ctx, drawerX, drawerY, drawerW, drawerH, 14, true, true);
        ctx.shadowBlur = 0;

        // ترويسة القائمة
        ctx.fillStyle = isLeft ? "#00e5ff" : "#ff007f";
        ctx.font = "bold 13px Segoe UI, sans-serif";
        ctx.fillText(`${cat.icon} ${cat.title} (${cat.items.length})`, drawerX + 16, drawerY + 28);

        // زر إغلاق القائمة ✕
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 15px Segoe UI, sans-serif";
        ctx.fillText("✕", drawerX + drawerW - 25, drawerY + 28);

        // خط فاصل
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.beginPath();
        ctx.moveTo(drawerX + 10, drawerY + 40);
        ctx.lineTo(drawerX + drawerW - 10, drawerY + 40);
        ctx.stroke();

        // منطقة عرض الصفوف مع التمرير
        ctx.save();
        ctx.beginPath();
        ctx.rect(drawerX + 6, drawerY + 45, drawerW - 12, drawerH - 52);
        ctx.clip();

        const startY = drawerY + 48 - this.drawerScrollY;

        cat.items.forEach((item, idx) => {
            const rowY = startY + (idx * 70);
            if (rowY + 65 < drawerY + 45 || rowY > drawerY + drawerH) return;

            const isWorn = (
                (this.wornItems.suit && this.wornItems.suit.id === item.id) ||
                (this.wornItems.maried && this.wornItems.maried.id === item.id) ||
                (this.wornItems.glasses && this.wornItems.glasses.id === item.id) ||
                (this.wornItems.scarf && this.wornItems.scarf.id === item.id) ||
                (this.wornItems.hair && this.wornItems.hair.id === item.id) ||
                (this.wornItems.cap && this.wornItems.cap.id === item.id) ||
                (this.wornItems.mask && this.wornItems.mask.id === item.id) ||
                (this.wornItems.graduition && this.wornItems.graduition.id === item.id)
            );

            const isBeingDragged = (this.draggedItem && this.draggedItem.id === item.id);

            ctx.save();
            if (isBeingDragged) {
                ctx.globalAlpha = 0.35;
            }

            const isHover = (
                this.handCursor.x >= drawerX + 10 &&
                this.handCursor.x <= drawerX + drawerW - 10 &&
                this.handCursor.y >= rowY &&
                this.handCursor.y <= rowY + 62
            );

            ctx.fillStyle = isHover ? "rgba(0, 229, 255, 0.2)" : "rgba(255, 255, 255, 0.05)";
            ctx.strokeStyle = isHover ? "#00dfd8" : (isWorn ? "#10b981" : "rgba(255, 255, 255, 0.12)");
            ctx.lineWidth = isHover ? 2.0 : 1.0;

            this.roundRect(ctx, drawerX + 10, rowY, drawerW - 20, 62, 8, true, true);

            // صورة المعاينة الشفافة
            const assetImg = this.assets[item.id];
            if (assetImg && assetImg.complete) {
                ctx.drawImage(assetImg, drawerX + 16, rowY + 6, 50, 50);
            }

            // عنوان القطعة
            ctx.fillStyle = isWorn ? "#10b981" : "#ffffff";
            ctx.font = "bold 11px Segoe UI, sans-serif";
            ctx.fillText(item.title, drawerX + 74, rowY + 28);

            // شارة الحالة
            if (isWorn) {
                ctx.fillStyle = "#10b981";
                ctx.font = "bold 9px Segoe UI, sans-serif";
                ctx.fillText("✓ ملبوس حالياً (WORN)", drawerX + 74, rowY + 46);
            } else {
                ctx.fillStyle = "#94a3b8";
                ctx.font = "9px Segoe UI, sans-serif";
                ctx.fillText("🤏 اقبض أو اضغط للارتداء", drawerX + 74, rowY + 46);
            }

            ctx.restore();
        });

        ctx.restore();
        ctx.restore();
    }

    renderWornAccessories(ctx, w, h) {
        // 1. البدلات والملابس الرسمية (suite)
        if (this.wornItems.suit) {
            this.renderSuitOnBody(ctx, this.wornItems.suit, w, h);
        }

        // 2. أزياء المناسبات والأعراس (maried)
        if (this.wornItems.maried) {
            this.renderSuitOnBody(ctx, this.wornItems.maried, w, h);
        }

        // 3. أزياء وقبعات التخرج (graduition)
        if (this.wornItems.graduition) {
            if (this.faceLandmarks) {
                this.renderCapOnHead(ctx, this.wornItems.graduition, w, h);
            } else {
                this.renderSuitOnBody(ctx, this.wornItems.graduition, w, h);
            }
        }

        // 4. الأوشحة والسكارفات (wishah)
        if (this.wornItems.scarf) {
            this.renderScarfOnNeck(ctx, this.wornItems.scarf, w, h);
        }

        // 5. الكمامات والأقنعة (mask)
        if (this.wornItems.mask) {
            this.renderMaskOnFace(ctx, this.wornItems.mask, w, h);
        }

        // 6. النظارات (glasses)
        if (this.wornItems.glasses) {
            this.renderGlassesOnFace(ctx, this.wornItems.glasses, w, h);
        }

        // 7. الكوافي والقبعات (cap)
        if (this.wornItems.cap) {
            this.renderCapOnHead(ctx, this.wornItems.cap, w, h);
        }

        // 8. قصات الشعر (hair)
        if (this.wornItems.hair) {
            this.renderHairOnHead(ctx, this.wornItems.hair, w, h);
        }
    }

    /**
     * التحويل الهندسي الدقيق لمطابقة نقطتين مرجعيتين (2-Point Anchor Matching Transform)
     * يطابق إحداثيات ملف التكست (Keypoints) بنقاط معالم الجسم (Pose/Face Landmarks) بدقة مليمترية 100%
     * مع فرز الاتجاه من اليسار لليمين لضمان بقاء الملابس معتدلة دائماً ومنع الانقلاب رأساً على عقب نهائياً
     */
    renderAnchoredAsset(ctx, assetImg, kp1, kp2, rawDstP1, rawDstP2, categoryName, scaleMultiplier = 1.0, shiftX = 0, shiftY = 0) {
        if (!assetImg || !assetImg.complete) return false;
        const nw = assetImg.naturalWidth || assetImg.width;
        const nh = assetImg.naturalHeight || assetImg.height;

        // 1. إحداثيات النقطتين على صورة القطعة من ملف التكست المرفق
        const p1x = kp1[0] * nw, p1y = kp1[1] * nh;
        const p2x = kp2[0] * nw, p2y = kp2[1] * nh;

        // فرز النقطتين على القطعة من اليسار إلى اليمين بدقة لمنع الانقلاب نهائياً
        let pLx, pLy, pRx, pRy;
        if (p1x <= p2x) {
            pLx = p1x; pLy = p1y;
            pRx = p2x; pRy = p2y;
        } else {
            pLx = p2x; pLy = p2y;
            pRx = p1x; pRy = p1y;
        }

        const L_src = Math.hypot(pRx - pLx, pRy - pLy);
        if (L_src < 2) return false;

        const ang_src = Math.atan2(pRy - pLy, pRx - pLx);
        const c_src_x = (pLx + pRx) / 2.0;
        const c_src_y = (pLy + pRy) / 2.0;

        // 2. فرز نقطتي الهدف (على جسم ووجه الشخص على الشاشة) من اليسار إلى اليمين
        let rawQLx, rawQLy, rawQRx, rawQRy;
        if (rawDstP1.x <= rawDstP2.x) {
            rawQLx = rawDstP1.x; rawQLy = rawDstP1.y;
            rawQRx = rawDstP2.x; rawQRy = rawDstP2.y;
        } else {
            rawQLx = rawDstP2.x; rawQLy = rawDstP2.y;
            rawQRx = rawDstP1.x; rawQRy = rawDstP1.y;
        }

        // تنعيم إحداثيات الهدف للشخص لضمان ثبات تام بدون أي ارتعاش (Jitter-free Adaptive EMA)
        if (!this.smoothedAnchors) this.smoothedAnchors = {};
        if (!this.smoothedAnchors[categoryName]) {
            this.smoothedAnchors[categoryName] = { qLx: null, qLy: null, qRx: null, qRy: null };
        }
        const cache = this.smoothedAnchors[categoryName];
        const qLx = this.smoothAdaptive(cache.qLx, rawQLx, 0.45, 0.86, 6.0);
        const qLy = this.smoothAdaptive(cache.qLy, rawQLy, 0.45, 0.86, 6.0);
        const qRx = this.smoothAdaptive(cache.qRx, rawQRx, 0.45, 0.86, 6.0);
        const qRy = this.smoothAdaptive(cache.qRy, rawQRy, 0.45, 0.86, 6.0);
        cache.qLx = qLx; cache.qLy = qLy;
        cache.qRx = qRx; cache.qRy = qRy;

        const L_dst = Math.hypot(qRx - qLx, qRy - qLy);
        if (L_dst < 2) return false;

        const ang_dst = Math.atan2(qRy - qLy, qRx - qLx);
        const c_dst_x = (qLx + qRx) / 2.0 + shiftX;
        const c_dst_y = (qLy + qRy) / 2.0 + shiftY;

        // 3. زاوية الدوران الطبيعية المعتدلة (دائماً معتدلة ولا يمكن أن تنقلب رأساً على عقب)
        let deltaTheta = ang_dst - ang_src;
        while (deltaTheta > Math.PI) deltaTheta -= 2 * Math.PI;
        while (deltaTheta < -Math.PI) deltaTheta += 2 * Math.PI;

        const finalScale = (L_dst / L_src) * scaleMultiplier;

        ctx.save();
        ctx.translate(c_dst_x, c_dst_y);
        ctx.rotate(deltaTheta);
        ctx.scale(finalScale, finalScale);
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 18;
        ctx.drawImage(assetImg, -c_src_x, -c_src_y);
        ctx.restore();
        return true;
    }

    /**
     * خوارزمية تطابق البدلة التشريحية بالاعتماد 100% على نقاط ملف التكست المحددة على الأكتاف (11 & 12)
     */
    renderSuitOnBody(ctx, suitItem, w, h) {
        const assetImg = this.assets[suitItem.id];
        if (!assetImg || !assetImg.complete) return;

        // 1. التطابق المباشر والدقيق 100% مع معالم التكست الموسومة (Keypoints 11 & 12)
        if (suitItem.keypoints && suitItem.keypoints['11'] && suitItem.keypoints['12'] &&
            this.poseLandmarks && this.poseLandmarks[11] && this.poseLandmarks[12]) {
            const rawDstP1 = {
                x: (1.0 - this.poseLandmarks[11].x) * w,
                y: this.poseLandmarks[11].y * h
            };
            const rawDstP2 = {
                x: (1.0 - this.poseLandmarks[12].x) * w,
                y: this.poseLandmarks[12].y * h
            };
            const scaleMult = this.suitScaleMultiplier ? (this.suitScaleMultiplier / 1.65) : 1.0;
            const shiftY = this.suitOffsetShiftY || 0;
            const ok = this.renderAnchoredAsset(
                ctx, assetImg,
                suitItem.keypoints['11'], suitItem.keypoints['12'],
                rawDstP1, rawDstP2,
                suitItem.category || 'suit',
                scaleMult, 0, shiftY
            );
            if (ok) return;
        }

        // المسار الاحتياطي في حال عدم توفر المعالم
        let rawNeckX = w / 2;
        let rawNeckY = h * 0.45;
        let rawShoulderSpan = (this.depthMetrics.shoulderPixels || 220);
        let rawTiltAngle = 0;

        if (this.poseLandmarks && this.poseLandmarks[11] && this.poseLandmarks[12]) {
            const ls = this.poseLandmarks[11];
            const rs = this.poseLandmarks[12];
            const sx1 = (1.0 - ls.x) * w, sy1 = ls.y * h;
            const sx2 = (1.0 - rs.x) * w, sy2 = rs.y * h;
            rawNeckX = (sx1 + sx2) / 2.0;
            rawNeckY = (sy1 + sy2) / 2.0;
            rawShoulderSpan = Math.hypot(sx1 - sx2, sy1 - sy2);
            rawTiltAngle = Math.atan2(sy1 - sy2, sx1 - sx2);
        }

        rawNeckY += (this.suitOffsetShiftY || 0);
        const neckX = this.smoothAdaptive(this.smoothed.suit.neckX, rawNeckX, 0.45, 0.86, 8.0);
        const neckY = this.smoothAdaptive(this.smoothed.suit.neckY, rawNeckY, 0.45, 0.86, 8.0);
        const shoulderSpan = this.smoothAdaptive(this.smoothed.suit.w, rawShoulderSpan, 0.50, 0.88, 6.0);
        const tiltAngle = this.smoothAngleAdaptive(this.smoothed.suit.angle, rawTiltAngle, 0.50, 0.88, 0.12);

        this.smoothed.suit.neckX = neckX;
        this.smoothed.suit.neckY = neckY;
        this.smoothed.suit.w = shoulderSpan;
        this.smoothed.suit.angle = tiltAngle;

        const scaleMult = this.suitScaleMultiplier || 1.65;
        const suitW = shoulderSpan * scaleMult;
        const suitH = suitW * (assetImg.naturalHeight / assetImg.naturalWidth);
        const collarOffsetLocalY = suitH * 0.035;

        ctx.save();
        ctx.translate(neckX, neckY);
        ctx.rotate(tiltAngle);
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 18;
        ctx.drawImage(assetImg, -suitW / 2, -collarOffsetLocalY, suitW, suitH);
        ctx.restore();
    }

    /**
     * رسم النظارات بمطابقة نقاط العيون (2 & 5) من ملف التكست بدقة 100%
     */
    renderGlassesOnFace(ctx, glassesItem, w, h) {
        const assetImg = this.assets[glassesItem.id];
        if (!assetImg || !assetImg.complete) return;

        if (glassesItem.keypoints && glassesItem.keypoints['2'] && glassesItem.keypoints['5']) {
            let p1 = null, p2 = null;
            if (this.faceLandmarks && this.faceLandmarks[33] && this.faceLandmarks[263]) {
                p1 = { x: (1.0 - this.faceLandmarks[33].x) * w, y: this.faceLandmarks[33].y * h };
                p2 = { x: (1.0 - this.faceLandmarks[263].x) * w, y: this.faceLandmarks[263].y * h };
            } else if (this.poseLandmarks && this.poseLandmarks[2] && this.poseLandmarks[5]) {
                p1 = { x: (1.0 - this.poseLandmarks[2].x) * w, y: this.poseLandmarks[2].y * h };
                p2 = { x: (1.0 - this.poseLandmarks[5].x) * w, y: this.poseLandmarks[5].y * h };
            }
            if (p1 && p2) {
                const ok = this.renderAnchoredAsset(
                    ctx, assetImg,
                    glassesItem.keypoints['2'], glassesItem.keypoints['5'],
                    p1, p2, 'glasses', 1.0, 0, 0
                );
                if (ok) return;
            }
        }

        const noseBridge = (this.faceLandmarks && (this.faceLandmarks[6] || this.faceLandmarks[168]));
        if (!noseBridge) return;
        const cx = (1.0 - noseBridge.x) * w;
        const cy = noseBridge.y * h;
        const eyeDist = (this.depthMetrics.ipdPixels || 75);
        const targetW = eyeDist * 2.35;
        const targetH = targetW * (assetImg.naturalHeight / assetImg.naturalWidth);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.drawImage(assetImg, -targetW / 2, -targetH / 2, targetW, targetH);
        ctx.restore();
    }

    /**
     * رسم الأوشحة بمطابقة نقاط الأكتاف (11 & 12) من ملف التكست بدقة 100%
     */
    renderScarfOnNeck(ctx, scarfItem, w, h) {
        const assetImg = this.assets[scarfItem.id];
        if (!assetImg || !assetImg.complete) return;

        if (scarfItem.keypoints && scarfItem.keypoints['11'] && scarfItem.keypoints['12'] &&
            this.poseLandmarks && this.poseLandmarks[11] && this.poseLandmarks[12]) {
            const p1 = { x: (1.0 - this.poseLandmarks[11].x) * w, y: this.poseLandmarks[11].y * h };
            const p2 = { x: (1.0 - this.poseLandmarks[12].x) * w, y: this.poseLandmarks[12].y * h };
            const ok = this.renderAnchoredAsset(
                ctx, assetImg,
                scarfItem.keypoints['11'], scarfItem.keypoints['12'],
                p1, p2, 'scarf', 1.0, 0, 0
            );
            if (ok) return;
        }

        if (this.faceLandmarks && this.faceLandmarks[152]) {
            const chin = this.faceLandmarks[152];
            const cx = (1.0 - chin.x) * w, cy = chin.y * h;
            const targetW = (this.depthMetrics.ipdPixels || 80) * 3.4;
            const targetH = targetW * (assetImg.naturalHeight / assetImg.naturalWidth);
            ctx.save();
            ctx.translate(cx, cy + (targetH * 0.18));
            ctx.drawImage(assetImg, -targetW / 2, -targetH / 2, targetW, targetH);
            ctx.restore();
        }
    }

    /**
     * رسم تسريحة الشعر بمطابقة نقاط الوجه والفم (9 & 10) من ملف التكست بدقة 100%
     */
    renderHairOnHead(ctx, hairItem, w, h) {
        const assetImg = this.assets[hairItem.id];
        if (!assetImg || !assetImg.complete) return;

        if (hairItem.keypoints && hairItem.keypoints['9'] && hairItem.keypoints['10']) {
            let p1 = null, p2 = null;
            if (this.poseLandmarks && this.poseLandmarks[9] && this.poseLandmarks[10]) {
                p1 = { x: (1.0 - this.poseLandmarks[9].x) * w, y: this.poseLandmarks[9].y * h };
                p2 = { x: (1.0 - this.poseLandmarks[10].x) * w, y: this.poseLandmarks[10].y * h };
            } else if (this.faceLandmarks && this.faceLandmarks[61] && this.faceLandmarks[291]) {
                p1 = { x: (1.0 - this.faceLandmarks[61].x) * w, y: this.faceLandmarks[61].y * h };
                p2 = { x: (1.0 - this.faceLandmarks[291].x) * w, y: this.faceLandmarks[291].y * h };
            }
            if (p1 && p2) {
                const ok = this.renderAnchoredAsset(
                    ctx, assetImg,
                    hairItem.keypoints['9'], hairItem.keypoints['10'],
                    p1, p2, 'hair', 1.0, 0, 0
                );
                if (ok) return;
            }
        }

        if (this.faceLandmarks && this.faceLandmarks[10]) {
            const forehead = this.faceLandmarks[10];
            const fx = (1.0 - forehead.x) * w, fy = forehead.y * h;
            const targetW = (this.depthMetrics.ipdPixels || 80) * 3.2;
            const targetH = targetW * (assetImg.naturalHeight / assetImg.naturalWidth);
            ctx.save();
            ctx.translate(fx, fy);
            ctx.drawImage(assetImg, -targetW / 2, -targetH * 0.82, targetW, targetH);
            ctx.restore();
        }
    }

    /**
     * رسم الكوفية أو القبعة بمطابقة نقاط العيون (2 & 5) المحددة على القبعة بدقة 100%
     */
    renderCapOnHead(ctx, capItem, w, h) {
        const assetImg = this.assets[capItem.id];
        if (!assetImg || !assetImg.complete) return;

        if (capItem.keypoints && capItem.keypoints['2'] && capItem.keypoints['5']) {
            let p1 = null, p2 = null;
            if (this.faceLandmarks && this.faceLandmarks[33] && this.faceLandmarks[263]) {
                p1 = { x: (1.0 - this.faceLandmarks[33].x) * w, y: this.faceLandmarks[33].y * h };
                p2 = { x: (1.0 - this.faceLandmarks[263].x) * w, y: this.faceLandmarks[263].y * h };
            } else if (this.poseLandmarks && this.poseLandmarks[2] && this.poseLandmarks[5]) {
                p1 = { x: (1.0 - this.poseLandmarks[2].x) * w, y: this.poseLandmarks[2].y * h };
                p2 = { x: (1.0 - this.poseLandmarks[5].x) * w, y: this.poseLandmarks[5].y * h };
            }
            if (p1 && p2) {
                const ok = this.renderAnchoredAsset(
                    ctx, assetImg,
                    capItem.keypoints['2'], capItem.keypoints['5'],
                    p1, p2, 'cap', 1.0, 0, 0
                );
                if (ok) return;
            }
        }

        if (this.faceLandmarks && this.faceLandmarks[10]) {
            const forehead = this.faceLandmarks[10];
            const fx = (1.0 - forehead.x) * w, fy = forehead.y * h;
            const targetW = (this.depthMetrics.ipdPixels || 80) * 3.4;
            const targetH = targetW * (assetImg.naturalHeight / assetImg.naturalWidth);
            ctx.save();
            ctx.translate(fx, fy);
            ctx.drawImage(assetImg, -targetW / 2, -targetH * 0.86, targetW, targetH);
            ctx.restore();
        }
    }

    /**
     * رسم الكمامة أو اللثام بمطابقة نقاط الفم (9 & 10) من ملف التكست بدقة 100%
     */
    renderMaskOnFace(ctx, maskItem, w, h) {
        const assetImg = this.assets[maskItem.id];
        if (!assetImg || !assetImg.complete) return;

        if (maskItem.keypoints && maskItem.keypoints['9'] && maskItem.keypoints['10']) {
            let p1 = null, p2 = null;
            if (this.poseLandmarks && this.poseLandmarks[9] && this.poseLandmarks[10]) {
                p1 = { x: (1.0 - this.poseLandmarks[9].x) * w, y: this.poseLandmarks[9].y * h };
                p2 = { x: (1.0 - this.poseLandmarks[10].x) * w, y: this.poseLandmarks[10].y * h };
            } else if (this.faceLandmarks && this.faceLandmarks[61] && this.faceLandmarks[291]) {
                p1 = { x: (1.0 - this.faceLandmarks[61].x) * w, y: this.faceLandmarks[61].y * h };
                p2 = { x: (1.0 - this.faceLandmarks[291].x) * w, y: this.faceLandmarks[291].y * h };
            }
            if (p1 && p2) {
                const ok = this.renderAnchoredAsset(
                    ctx, assetImg,
                    maskItem.keypoints['9'], maskItem.keypoints['10'],
                    p1, p2, 'mask', 1.0, 0, 0
                );
                if (ok) return;
            }
        }

        if (this.faceLandmarks && this.faceLandmarks[152]) {
            const chin = this.faceLandmarks[152];
            const cx = (1.0 - chin.x) * w, cy = chin.y * h;
            const targetW = (this.depthMetrics.ipdPixels || 80) * 2.8;
            const targetH = targetW * (assetImg.naturalHeight / assetImg.naturalWidth);
            ctx.save();
            ctx.translate(cx, cy);
            ctx.drawImage(assetImg, -targetW / 2, -targetH / 2, targetW, targetH);
            ctx.restore();
        }
    }

        renderDraggedItem(ctx) {
        const assetImg = this.assets[this.draggedItem.id];
        if (!assetImg || !assetImg.complete) return;

        ctx.save();
        const dw = 110;
        const dh = dw * (assetImg.naturalHeight / assetImg.naturalWidth);

        ctx.shadowColor = "#00e5ff";
        ctx.shadowBlur = 24;
        ctx.drawImage(assetImg, this.handCursor.x - dw / 2, this.handCursor.y - dh / 2, dw, dh);
        ctx.restore();
    }

    renderHandCursor(ctx) {
        if (!this.handCursor.isVisible) return;

        const isPinch = this.handCursor.isPinching;
        const isHolding = this.handCursor.isHolding || Boolean(this.draggedItem);
        const x = this.handCursor.x;
        const y = this.handCursor.y;

        ctx.save();

        // 1. الحلقة الخارجية المتوهجة (State-Aware Glow Ring)
        ctx.beginPath();
        const outerR = isPinch ? 20 : 14;
        ctx.arc(x, y, outerR, 0, 2 * Math.PI);
        ctx.fillStyle = isHolding 
            ? "rgba(236, 72, 153, 0.28)" 
            : (isPinch ? "rgba(168, 85, 247, 0.35)" : "rgba(0, 229, 255, 0.22)");
        ctx.strokeStyle = isHolding ? "#ec4899" : (isPinch ? "#a855f7" : "#00e5ff");
        ctx.lineWidth = isPinch ? 3.0 : 2.0;
        ctx.shadowColor = isHolding ? "#ec4899" : (isPinch ? "#a855f7" : "#00e5ff");
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.stroke();

        // 2. النقطة المركزية فائقة الدقة
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = "#ffffff";
        ctx.shadowBlur = 4;
        ctx.shadowColor = "#ffffff";
        ctx.fill();

        // 3. شارة الحالة الأنيقة
        if (isHolding) {
            ctx.font = "bold 9px Segoe UI, sans-serif";
            ctx.fillStyle = "#ec4899";
            ctx.fillText("✊ GRAB", x + 24, y + 4);
        } else if (isPinch) {
            ctx.font = "bold 9px Segoe UI, sans-serif";
            ctx.fillStyle = "#00e5ff";
            ctx.fillText("🤏 PINCH", x + 24, y + 4);
        } else if (this.handCursor.isPointing) {
            ctx.font = "bold 9px Segoe UI, sans-serif";
            ctx.fillStyle = "#00e5ff";
            ctx.fillText("👆 POINTER", x + 24, y + 4);

            // شعيرات ليزر التقاطع الدقيقة للمؤشر
            ctx.beginPath();
            ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y);
            ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14);
            ctx.strokeStyle = "rgba(0, 229, 255, 0.85)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * رسم شبكة ونقاط الوجه والجذع (Face Mesh 468 + Pose Shoulders)
     */
    renderFaceAndBodyLandmarks(ctx, w, h) {
        if (!ctx) return;

        // 1. معالم الوجه (MediaPipe Face Mesh)
        if (this.faceLandmarks && this.faceLandmarks.length > 0) {
            ctx.save();

            const FACE_LOOPS = [
                // محيط الوجه البيضاوي الخارجي (Face Oval)
                [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
                // الحاجب الأيمن (شاشة)
                [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
                // الحاجب الأيسر (شاشة)
                [336, 296, 334, 293, 300, 285, 295, 282, 283, 276],
                // العين اليمنى (شاشة)
                [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],
                // العين اليسرى (شاشة)
                [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263],
                // محيط الشفتين الخارجي والداخلي
                [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78, 61],
                [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
                // جسر وقصبة الأنف
                [168, 6, 197, 195, 5, 4, 1, 19, 94, 2]
            ];

            // رسم خطوط الملامح النيونية المتصلة
            ctx.strokeStyle = "rgba(0, 229, 255, 0.40)";
            ctx.lineWidth = 1.2;

            FACE_LOOPS.forEach(loop => {
                ctx.beginPath();
                for (let i = 0; i < loop.length; i++) {
                    const pt = this.faceLandmarks[loop[i]];
                    if (!pt) continue;
                    const sx = (1.0 - pt.x) * w;
                    const sy = pt.y * h;
                    if (i === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                }
                ctx.stroke();
            });

            // رسم النقاط الحيوية المضيئة للوجه
            const KEY_POINTS = [
                10, 152, 1, 4, 6, 168, 197, 195,
                33, 133, 159, 145, 263, 362, 386, 374,
                70, 107, 336, 300,
                61, 291, 0, 17, 13, 14,
                234, 454, 127, 356,
                468, 473 // بؤبؤ العين
            ];

            KEY_POINTS.forEach(idx => {
                const pt = this.faceLandmarks[idx];
                if (!pt) return;
                const sx = (1.0 - pt.x) * w;
                const sy = pt.y * h;
                const isIris = (idx === 468 || idx === 473);

                ctx.beginPath();
                ctx.arc(sx, sy, isIris ? 3.5 : 2.2, 0, 2 * Math.PI);
                ctx.fillStyle = isIris ? "#ffd600" : "rgba(0, 229, 255, 0.85)";
                ctx.shadowColor = isIris ? "#ffd600" : "#00e5ff";
                ctx.shadowBlur = isIris ? 8 : 4;
                ctx.fill();
            });

            ctx.restore();
        }

        // 2. معالم الأذرع والجذع والأكتاف (MediaPipe Pose Arms & Torso Skeleton)
        if (this.poseLandmarks && this.poseLandmarks.length > 0) {
            ctx.save();

            // روابط عظام الأذرع والجذع
            const ARM_CONNECTIONS = [
                [11, 12], // خط الأكتاف (Shoulders)
                [11, 13], // الكتف الأيسر -> المرفق الأيسر (Left Upper Arm)
                [13, 15], // المرفق الأيسر -> المعصم الأيسر (Left Forearm)
                [12, 14], // الكتف الأيمن -> المرفق الأيمن (Right Upper Arm)
                [14, 16], // المرفق الأيمن -> المعصم الأيمن (Right Forearm)
                [15, 17], // المعصم الأيسر -> كف اليد
                [15, 19], // المعصم الأيسر -> السبابة
                [16, 18], // المعصم الأيمن -> كف اليد
                [16, 20], // المعصم الأيمن -> السبابة
                [11, 23], // الكتف الأيسر -> الحوض الأيسر (Left Torso)
                [12, 24], // الكتف الأيمن -> الحوض الأيمن (Right Torso)
                [23, 24]  // خط الخصر والحوض (Hips / Waist)
            ];

            // 1. رسم خطوط الأذرع والجذع المتوهجة
            ctx.strokeStyle = "rgba(0, 255, 170, 0.75)";
            ctx.lineWidth = 2.5;
            ctx.shadowColor = "#00ffaa";
            ctx.shadowBlur = 10;

            ARM_CONNECTIONS.forEach(([i, j]) => {
                const p1 = this.poseLandmarks[i];
                const p2 = this.poseLandmarks[j];
                if (!p1 || !p2) return;
                const v1 = p1.visibility !== undefined ? p1.visibility : 1.0;
                const v2 = p2.visibility !== undefined ? p2.visibility : 1.0;
                if (v1 < 0.20 || v2 < 0.20) return;

                const x1 = (1.0 - p1.x) * w;
                const y1 = p1.y * h;
                const x2 = (1.0 - p2.x) * w;
                const y2 = p2.y * h;

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            });

            // 2. رسم مفاصل الأذرع (الأكتاف والمرافق والمعاصم)
            const ARM_JOINTS = [
                { idx: 11, r: 5.5, color: "#10b981" }, // كتف أيسر
                { idx: 12, r: 5.5, color: "#10b981" }, // كتف أيمن
                { idx: 13, r: 5.0, color: "#00e5ff" }, // مرفق أيسر
                { idx: 14, r: 5.0, color: "#00e5ff" }, // مرفق أيمن
                { idx: 15, r: 4.5, color: "#ffd600" }, // معصم أيسر
                { idx: 16, r: 4.5, color: "#ffd600" }, // معصم أيمن
                { idx: 23, r: 4.0, color: "#10b981" }, // حوض أيسر
                { idx: 24, r: 4.0, color: "#10b981" }  // حوض أيمن
            ];

            ARM_JOINTS.forEach(j => {
                const pt = this.poseLandmarks[j.idx];
                if (!pt) return;
                const v = pt.visibility !== undefined ? pt.visibility : 1.0;
                if (v < 0.20) return;

                const sx = (1.0 - pt.x) * w;
                const sy = pt.y * h;

                ctx.beginPath();
                ctx.arc(sx, sy, j.r, 0, 2 * Math.PI);
                ctx.fillStyle = j.color;
                ctx.shadowColor = j.color;
                ctx.shadowBlur = 10;
                ctx.fill();

                // حلقة مركزية بيضاء ناصعة
                ctx.beginPath();
                ctx.arc(sx, sy, j.r * 0.45, 0, 2 * Math.PI);
                ctx.fillStyle = "#ffffff";
                ctx.shadowBlur = 0;
                ctx.fill();
            });

            // منخفض الرقبة (Neck Anchor)
            const ls = this.poseLandmarks[11];
            const rs = this.poseLandmarks[12];
            if (ls && rs) {
                const lsx = (1.0 - ls.x) * w;
                const lsy = ls.y * h;
                const rsx = (1.0 - rs.x) * w;
                const rsy = rs.y * h;
                const neckX = (lsx + rsx) / 2.0;
                const neckY = (lsy + rsy) / 2.0;

                ctx.beginPath();
                ctx.arc(neckX, neckY, 4.0, 0, 2 * Math.PI);
                ctx.fillStyle = "#00e5ff";
                ctx.shadowColor = "#00e5ff";
                ctx.shadowBlur = 8;
                ctx.fill();
            }

            ctx.restore();
        }
    }

    /**
     * رسم نقاط وهيكل اليدين والأصابع كاملة (Hand Landmarks & Finger Skeleton)
     */
    renderHandAndFingerLandmarks(ctx, w, h) {
        if (!ctx || !this.handLandmarksList || this.handLandmarksList.length === 0) return;

        // روابط عظام اليد والأصابع الـ 21
        const HAND_CONNECTIONS = [
            [0, 1], [1, 2], [2, 3], [3, 4],        // الإبهام (Thumb)
            [0, 5], [5, 6], [6, 7], [7, 8],        // السبابة (Index)
            [5, 9], [9, 10], [10, 11], [11, 12],   // الوسطى (Middle)
            [9, 13], [13, 14], [14, 15], [15, 16], // البنصر (Ring)
            [13, 17], [17, 18], [18, 19], [19, 20],// الخنصر (Pinky)
            [0, 17]                                // قاعدة راحة اليد (Palm Base)
        ];

        const FINGERTIP_INDICES = [4, 8, 12, 16, 20];

        this.handLandmarksList.forEach((landmarks, handIdx) => {
            if (!landmarks || landmarks.length < 21) return;
            ctx.save();

            const isFirstHand = (handIdx === 0);
            const mainGlowColor = isFirstHand ? "#00dfd8" : "#ff007f";
            const boneLineColor = isFirstHand ? "rgba(0, 223, 216, 0.75)" : "rgba(255, 0, 127, 0.75)";

            // 1. رسم عظام الأصابع وراحة اليد (Bones Connections)
            ctx.strokeStyle = boneLineColor;
            ctx.lineWidth = 2.5;
            ctx.shadowColor = mainGlowColor;
            ctx.shadowBlur = 6;

            HAND_CONNECTIONS.forEach(([i, j]) => {
                const p1 = landmarks[i];
                const p2 = landmarks[j];
                const x1 = (1.0 - p1.x) * w;
                const y1 = p1.y * h;
                const x2 = (1.0 - p2.x) * w;
                const y2 = p2.y * h;

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            });

            // 2. رسم مفاصل الأصابع والنقاط الـ 21 (Joints & Nodes)
            landmarks.forEach((pt, idx) => {
                const sx = (1.0 - pt.x) * w;
                const sy = pt.y * h;
                const isTip = FINGERTIP_INDICES.includes(idx);
                const isThumbTip = (idx === 4);
                const isIndexTip = (idx === 8);

                ctx.beginPath();
                if (isTip) {
                    // أطراف الأصابع: هالة دائرية مميزة ومكبرة
                    ctx.arc(sx, sy, 6.0, 0, 2 * Math.PI);
                    ctx.fillStyle = isIndexTip ? "#00e5ff" : (isThumbTip ? "#facc15" : "#ff007f");
                    ctx.shadowColor = ctx.fillStyle;
                    ctx.shadowBlur = 12;
                    ctx.fill();

                    // حلقة داخلية بيضاء ناصعة
                    ctx.beginPath();
                    ctx.arc(sx, sy, 2.5, 0, 2 * Math.PI);
                    ctx.fillStyle = "#ffffff";
                    ctx.shadowBlur = 0;
                    ctx.fill();
                } else if (idx === 0) {
                    // معصم اليد (Wrist)
                    ctx.arc(sx, sy, 5.0, 0, 2 * Math.PI);
                    ctx.fillStyle = "#10b981";
                    ctx.shadowColor = "#10b981";
                    ctx.shadowBlur = 8;
                    ctx.fill();
                } else {
                    // مفاصل الأصابع (Knuckles / Joints)
                    ctx.arc(sx, sy, 3.2, 0, 2 * Math.PI);
                    ctx.fillStyle = "#38bdf8";
                    ctx.shadowColor = "#38bdf8";
                    ctx.shadowBlur = 5;
                    ctx.fill();
                }
            });

            // 3. مؤشر القرص/الإمساك التفاعلي بين الإبهام والسبابة
            const thumb = landmarks[4];
            const index = landmarks[8];
            const tx = (1.0 - thumb.x) * w;
            const ty = thumb.y * h;
            const ix = (1.0 - index.x) * w;
            const iy = index.y * h;
            const pinchDist = Math.hypot(tx - ix, ty - iy);

            if (pinchDist < 55) {
                ctx.strokeStyle = "#ff007f";
                ctx.lineWidth = 2.0;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(tx, ty);
                ctx.lineTo(ix, iy);
                ctx.stroke();
                ctx.setLineDash([]);

                const midX = (tx + ix) / 2.0;
                const midY = (ty + iy) / 2.0;
                ctx.beginPath();
                ctx.arc(midX, midY, pinchDist < 35 ? 9 : 6, 0, 2 * Math.PI);
                ctx.fillStyle = "rgba(255, 0, 127, 0.45)";
                ctx.strokeStyle = "#ff007f";
                ctx.lineWidth = 2.0;
                ctx.shadowColor = "#ff007f";
                ctx.shadowBlur = 14;
                ctx.fill();
                ctx.stroke();
            }

            ctx.restore();
        });
    }

    renderMetricsHUD(ctx, w, h) {
        ctx.save();
        const hudX = w / 2 - 275;
        const hudY = 18;
        const hudW = 550;
        const hudH = 50;

        ctx.fillStyle = "rgba(10, 14, 24, 0.88)";
        ctx.strokeStyle = this.showLandmarks ? "rgba(0, 255, 170, 0.55)" : "rgba(0, 229, 255, 0.35)";
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, hudX, hudY, hudW, hudH, 10, true, true);

        ctx.fillStyle = "#00e5ff";
        ctx.font = "bold 11px Fira Code, monospace";
        const ipdText = `IPD: ${Math.round(this.depthMetrics.ipdPixels)}px | Face Depth: ${this.depthMetrics.faceDepthCm}cm`;
        const bodyText = `Shoulders: ${Math.round(this.depthMetrics.shoulderPixels)}px | Body Depth: ${this.depthMetrics.bodyDepthCm}cm`;

        ctx.fillText(ipdText, hudX + 16, hudY + 20);
        ctx.fillStyle = "#a5f3fc";
        ctx.fillText(bodyText, hudX + 16, hudY + 38);

        // شارة وزر التحكم بنقاط الوجه واليدين والأصابع (Landmarks Toggle Badge)
        const badgeX = hudX + hudW - 195;
        const badgeY = hudY + 10;
        const badgeW = 180;
        const badgeH = 30;

        ctx.fillStyle = this.showLandmarks ? "rgba(16, 185, 129, 0.25)" : "rgba(255, 255, 255, 0.08)";
        ctx.strokeStyle = this.showLandmarks ? "#10b981" : "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1.2;
        this.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 6, true, true);

        ctx.fillStyle = this.showLandmarks ? "#10b981" : "#94a3b8";
        ctx.font = "bold 10px Segoe UI, sans-serif";
        const lmkText = this.showLandmarks ? "👁️ نقاط الوجه واليدين: مفعلة" : "👁️ نقاط الوجه واليدين: معطلة";
        ctx.fillText(lmkText, badgeX + 10, badgeY + 19);

        // شريط ضبط وتفصيل مقاس البدلة التفاعلي عند ارتدائها
        if (this.wornItems.suit) {
            const barW = 550;
            const barH = 38;
            const barX = w / 2 - barW / 2;
            const barY = hudY + hudH + 10;

            ctx.fillStyle = "rgba(10, 16, 30, 0.92)";
            ctx.strokeStyle = "rgba(59, 130, 246, 0.55)";
            ctx.lineWidth = 1.3;
            this.roundRect(ctx, barX, barY, barW, barH, 8, true, true);

            // عنوان
            ctx.fillStyle = "#93c5fd";
            ctx.font = "bold 11px Segoe UI, sans-serif";
            ctx.fillText("👔 ضبط البدلة:", barX + 12, barY + 23);

            const scalePct = Math.round((this.suitScaleMultiplier || 1.65) * 100);

            // زر تصغير [-]
            const btnMinusX = barX + 95;
            const btnMinusW = 60;
            ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
            this.roundRect(ctx, btnMinusX, barY + 6, btnMinusW, 26, 5, true, true);
            ctx.fillStyle = "#f1f5f9";
            ctx.font = "bold 11px Segoe UI, sans-serif";
            ctx.fillText("➖ تصغير", btnMinusX + 8, barY + 23);

            // مؤشر النسبة المئوية
            ctx.fillStyle = "#38bdf8";
            ctx.font = "bold 11px Fira Code, monospace";
            ctx.fillText(`${scalePct}%`, btnMinusX + btnMinusW + 10, barY + 23);

            // زر تكبير [+]
            const btnPlusX = btnMinusX + btnMinusW + 50;
            const btnPlusW = 60;
            ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
            this.roundRect(ctx, btnPlusX, barY + 6, btnPlusW, 26, 5, true, true);
            ctx.fillStyle = "#f1f5f9";
            ctx.font = "bold 11px Segoe UI, sans-serif";
            ctx.fillText("➕ تكبير", btnPlusX + 8, barY + 23);

            // أزرار رفع وخفض الياقة
            const btnUpX = btnPlusX + btnPlusW + 15;
            const btnUpW = 52;
            ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
            this.roundRect(ctx, btnUpX, barY + 6, btnUpW, 26, 5, true, true);
            ctx.fillStyle = "#f1f5f9";
            ctx.font = "bold 11px Segoe UI, sans-serif";
            ctx.fillText("⬆️ رفع", btnUpX + 8, barY + 23);

            const btnDownX = btnUpX + btnUpW + 6;
            const btnDownW = 52;
            ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
            this.roundRect(ctx, btnDownX, barY + 6, btnDownW, 26, 5, true, true);
            ctx.fillStyle = "#f1f5f9";
            ctx.fillText("⬇️ خفض", btnDownX + 8, barY + 23);

            // زر إعادة الضبط للافتراضي [🔄]
            const btnResetX = btnDownX + btnDownW + 8;
            const btnResetW = 60;
            ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
            ctx.strokeStyle = "rgba(59, 130, 246, 0.60)";
            this.roundRect(ctx, btnResetX, barY + 6, btnResetW, 26, 5, true, true);
            ctx.fillStyle = "#60a5fa";
            ctx.fillText("🔄 ضبط", btnResetX + 10, barY + 23);
        }

        ctx.restore();
    }

    takeSnapshot() {
        if (!this.mirrorCanvas) return;

        const flash = document.createElement("div");
        flash.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:#fff; z-index:99999; pointer-events:none; transition:opacity 0.6s;";
        document.body.appendChild(flash);
        setTimeout(() => { flash.style.opacity = "0"; setTimeout(() => flash.remove(), 600); }, 50);

        const dataUrl = this.mirrorCanvas.toDataURL("image/png");
        this.app.commitNewBaseImage(dataUrl);
        this.close();
        this.app.showToast("تم التقاط صورة المرآة وتمريرها للاستوديو بنجاح! 📸🎨", "✨");
    }

    async takeMagicAISnapshot() {
        if (!this.mirrorCanvas || !this.videoElement) return;

        // 1. وميض أرجواني سينمائي
        const flash = document.createElement("div");
        flash.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:radial-gradient(circle, rgba(217,70,239,0.85), rgba(168,85,247,0.95)); z-index:99999; pointer-events:none; transition:opacity 0.7s;";
        document.body.appendChild(flash);
        setTimeout(() => { flash.style.opacity = "0"; setTimeout(() => flash.remove(), 700); }, 80);

        // 2. إظهار نافذة التحميل والانتظار بالذكاء الاصطناعي
        const overlay = document.createElement("div");
        overlay.id = "magicTryonOverlay";
        overlay.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(8,12,22,0.90); backdrop-filter:blur(10px); z-index:999999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; font-family:'Segoe UI', sans-serif;";
        overlay.innerHTML = `
            <div style="font-size:54px; margin-bottom:15px; animation:spin 2s linear infinite;">🪄</div>
            <h2 style="margin:0 0 8px 0; background:linear-gradient(135deg, #a855f7, #ec4899); -webkit-background-clip:text; -webkit-text-fill-color:transparent; font-size:24px; font-weight:800;">جاري التوليد السحري الفائق (Magic AI TPS)...</h2>
            <p style="color:#94a3b8; font-size:13px; margin:0 0 22px 0;">تطبيق التشويه المرن للأنسجة TPS • تحييد ومسح القميص القديم • إسقاط الظلال الفيزيائية</p>
            <div style="width:280px; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                <div style="width:100%; height:100%; background:linear-gradient(90deg, #a855f7, #ec4899); animation:progress 1.5s ease-in-out infinite;"></div>
            </div>
            <style>
                @keyframes spin { 0% { transform: scale(1) rotate(0deg); } 50% { transform: scale(1.15) rotate(180deg); } 100% { transform: scale(1) rotate(360deg); } }
                @keyframes progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
            </style>
        `;
        document.body.appendChild(overlay);

        try {
            // رسم لقطة الكاميرا النظيفة الأصلية (كاميرا اللابتوب أو كاميرا الجوال)
            const rawCanvas = document.createElement("canvas");
            const src = (this.cameraSource === "ipcam" && this.ipCamImg && this.ipCamImg.naturalWidth > 0)
                ? this.ipCamImg
                : this.videoElement;
            rawCanvas.width = src.videoWidth || src.naturalWidth || 1280;
            rawCanvas.height = src.videoHeight || src.naturalHeight || 720;
            const rCtx = rawCanvas.getContext("2d");
            rCtx.translate(rawCanvas.width, 0);
            rCtx.scale(-1, 1);
            rCtx.drawImage(src, 0, 0, rawCanvas.width, rawCanvas.height);
            const rawBase64 = rawCanvas.toDataURL("image/png");

            // تجميع نقاط المعالم بدقة
            const lmDict = {};
            if (this.poseLandmarks) {
                if (this.poseLandmarks[11]) lmDict["left_shoulder"] = [1.0 - this.poseLandmarks[11].x, this.poseLandmarks[11].y];
                if (this.poseLandmarks[12]) lmDict["right_shoulder"] = [1.0 - this.poseLandmarks[12].x, this.poseLandmarks[12].y];
                if (this.poseLandmarks[23]) lmDict["left_hip"] = [1.0 - this.poseLandmarks[23].x, this.poseLandmarks[23].y];
                if (this.poseLandmarks[24]) lmDict["right_hip"] = [1.0 - this.poseLandmarks[24].x, this.poseLandmarks[24].y];
            }
            if (this.faceLandmarks) {
                if (this.faceLandmarks[152]) lmDict["chin"] = [1.0 - this.faceLandmarks[152].x, this.faceLandmarks[152].y];
                if (this.faceLandmarks[33]) lmDict["left_eye"] = [1.0 - this.faceLandmarks[33].x, this.faceLandmarks[33].y];
                if (this.faceLandmarks[263]) lmDict["right_eye"] = [1.0 - this.faceLandmarks[263].x, this.faceLandmarks[263].y];
            }

            const payload = {
                image: rawBase64,
                worn_items: this.wornItems,
                landmarks: lmDict,
                options: {
                    use_tps: true,
                    neutralize_torso: true,
                    suitScaleMultiplier: this.suitScaleMultiplier || 1.65,
                    suitOffsetShiftY: this.suitOffsetShiftY || 0
                }
            };

            const response = await fetch("/api/magic_tryon", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            if (document.getElementById("magicTryonOverlay")) {
                document.getElementById("magicTryonOverlay").remove();
            }

            if (result.status === "success" && result.image) {
                this.app.commitNewBaseImage(result.image);
                this.close();
                this.app.showToast("تم التوليد السحري بنجاح عبر محرك TPS والتحييد الذكي! 🪄✨", "🎉");
            } else {
                throw new Error(result.message || "فشلت المعالجة");
            }

        } catch (err) {
            if (document.getElementById("magicTryonOverlay")) {
                document.getElementById("magicTryonOverlay").remove();
            }
            console.error("Magic TryOn error:", err);
            this.app.showToast(`تنبيه: تم استخدام اللقطة المباشرة (${err.message})`, "⚠️");
            this.takeSnapshot();
        }
    }

    clearWorn() {
        this.wornItems = {
            glasses: null,
            cap: null,
            hair: null,
            mask: null,
            scarf: null,
            suit: null,
            maried: null,
            graduition: null
        };
        this.app.showToast("تم نزع كافة الأكسسوارات والملابس 🔄", "🧹");
    }

    roundRect(ctx, x, y, width, height, radius, fill, stroke) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }
}

// Global initialization helper
window.arMirrorStudio = null;
let arMirrorStudio = null;

function toggleARMirror() {
    if (!window.arMirrorStudio && !arMirrorStudio && window.app) {
        const gesture = window.gestureController || (typeof gestureController !== "undefined" ? gestureController : null);
        window.arMirrorStudio = new ARMirrorStudio(window.app, gesture);
        arMirrorStudio = window.arMirrorStudio;
    }
    const studio = window.arMirrorStudio || arMirrorStudio;
    if (studio) {
        if (studio.isActive) {
            studio.close();
        } else {
            studio.open();
        }
    }
}
