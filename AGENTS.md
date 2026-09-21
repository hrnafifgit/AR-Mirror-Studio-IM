# VisionCraft AR Smart Mirror & Try-On Studio — Agent Knowledge Base (`AGENTS.md`)

> **Note for AI Agents & Developers:**  
> This file is the primary context and knowledge base for this repository. When asked to modify, debug, or extend this project, read this document first to understand the architecture, file mapping, mathematical models, foundational prompts, and extension points without needing to re-parse the entire codebase.

---

## 1. Project Overview & Objective

**VisionCraft AR Smart Mirror** is a real-time (60 FPS) Augmented Reality Virtual Try-On and Fitting Room system. It enables users to virtually try on formal suits, wedding dresses, graduation gowns, traditional shawls (Wishah), wigs, sunglasses, masks, and caps in real time with accurate anatomical tracking.

The system is available in two implementations:
1. **Python Native Desktop App (`run_ar_studio.py` / `run.py`)**: The primary high-performance desktop application using OpenCV, MediaPipe Tasks Vision API, PIL, and NumPy.
2. **Web AR Studio (`web_ar/`)**: A client-side browser implementation using HTML5 Canvas, Vanilla CSS, and JavaScript with MediaPipe Web APIs.

---

## 2. Architecture & File Responsibility Matrix

```
2_ar_mirror_tryon_studio/
├── AGENTS.md                   # Primary AI Agent knowledge base & context (This file)
├── README.md                   # User-facing overview and setup instructions
├── requirements.txt            # Python dependencies (opencv, mediapipe, pillow, etc.)
├── run.py                      # Lightweight launcher script for run_ar_studio.py
├── run_ar_studio.py            # MAIN ENGINE: 1,500+ lines monolithic desktop AR application
│
├── core_tryon/                 # Deep fitting & deformation algorithms
│   ├── __init__.py
│   ├── base.py                 # Abstract base class for virtual try-on modules
│   ├── cloth_agnostic.py       # Body & clothing segmentation mask generation
│   ├── tps_warper.py           # Thin Plate Spline (TPS) non-rigid cloth warping
│   └── ar_tryon.py             # Advanced landmark-driven try-on orchestrator
│
├── models/                     # Pre-trained MediaPipe Task model binaries
│   ├── face_landmarker.task    # 468/478 facial landmarks + blendshapes
│   ├── pose_landmarker.task    # 33 full-body skeletal landmarks
│   ├── hand_landmarker.task    # 21 hand skeletal landmarks per hand
│   └── selfie_segmenter.tflite # Real-time person background segmentation
│
├── things_assets/              # Asset storage & anatomical anchor metadata
│   ├── catalog.json            # Master registry of all wearable items and categories
│   ├── backgrounds/            # Virtual dressing room wallpapers & panoramas
│   │   ├── panorama_room_3840.jpg  # 3-wall wide panoramic room (3840x720) with real assets
│   │   ├── panorama_room_3840_backup.jpg # Original baseline panorama backup
│   │   ├── spatial_hotspots.json   # Pixel-perfect bounding boxes for all 25 wall items
│   │   ├── build_panorama.py       # Script to synthesize real assets onto luxury boutique walls
│   │   └── house_wall.jpg
│   ├── cap/                    # Caps & hats (.png + .json anchor points)
│   ├── glasses/                # Eyewear (.png + .json anchor points)
│   ├── graduition/             # Graduation gowns & caps (.png + .json)
│   ├── hair/                   # Hairstyles & wigs (.png + .json)
│   ├── maried/                 # Bridal gowns & suits (.png + .json)
│   ├── mask/                   # Face masks (.png + .json)
│   ├── suite/                  # Formal suits & blazers (.png + .json)
│   └── wishah/                 # Traditional shawls & scarves (.png + .json)
│
├── web_ar/                     # Browser-based AR Mirror
│   ├── ar_studio.html          # Main web application entry point
│   ├── css/                    # Glassmorphism UI & gesture feedback styling
│   └── js/
│       ├── ar_mirror.js        # Core Web AR camera & canvas render loop
│       ├── gesture_controller.js # Web hand pinch & swipe detection
│       ├── photo_tryon.js      # Static photo fitting module
│       └── ar/                 # Catalog, UI & fitting helpers
│
└── snapshots/                  # Auto-generated directory for captured HD photos
```

---

## 3. Core Mechanics & Mathematical Models

### 3.1 3-Wall Virtual Dressing Room & Parallax Scrolling
* **Concept**: The user stands inside a 3-wall virtual boutique:
  * **Left Wall**: Traditional shawls (Wishah), Hair, Face Masks.
  * **Center Wall**: Formal Suits, Bridal Gowns, Graduation Outfits.
  * **Right Wall**: Eyewear, Caps, and Hats.
* **Tracking Parallax (Pure Nose & Head Tracking)**: 
  * Tracks the **Nose Tip** (Face Landmark `1`) relative to Cheeks (`234`, `454`).
  * **Eye Gaze Isolation**: Eye iris saccades are explicitly removed from camera panning to prevent jitter when reading the UI or moving eyes.
  * **Kinetic Gimbal Damping**: Applies a center deadband ($|\text{yaw}| < 0.038$) and continuous exponential smoothing ($\alpha = 0.88$) for cinematic, jump-free panning.
* **Viewport Formula**:
  $$\text{Raw Yaw} = \frac{d_{\text{right}} - d_{\text{left}}}{\max(1.0, d_{\text{left}} + d_{\text{right}})} - \text{Offset}_{\text{calib}}$$
  $$\text{Offset}_X = \text{Clamp}\left(\text{Center} + \text{Yaw} \times \text{Sensitivity}, 0, W_{\text{panorama}} - W_{\text{frame}}\right)$$
* **Manual Calibration**: Key `[R]` recenters the current head position to zero yaw.

### 3.2 Anatomical Asset Fitting & Keypoint Binding
Each PNG asset in `things_assets/<category>/<name>.png` has a matching `<name>.json` defining normalized coordinate anchors:
* **Suits (`suite`, `maried`, `graduition`)**:
  * Anchored to MediaPipe Pose Landmarks: **11** (Left Shoulder) and **12** (Right Shoulder).
  * Scale factor is calculated from Euclidean distance between shoulders:
    $$D_{\text{shoulder}} = \sqrt{(x_{12} - x_{11})^2 + (y_{12} - y_{11})^2}$$
  * Rotation angle computed via $\arctan2(y_{12}-y_{11}, x_{12}-x_{11})$ for natural tilting.
* **Glasses (`glasses`)**:
  * Anchored to Face Landmarks: **33** (Left Eye outer corner) and **263** (Right Eye outer corner) or nose bridge.
* **Caps & Hair (`cap`, `hair`)**:
  * Anchored to Face Landmark **10** (Top forehead center) with vertical scaling upwards.
* **Wishah / Scarves (`wishah`)**:
  * Anchored between Neck / Collarbone landmarks (Pose 11, 12, and Face 152 chin base).

### 3.3 Air Gestures (Touchless Interaction)
* **Hand Detection**: MediaPipe `hand_landmarker.task` tracks 21 points per hand.
* **Pinch Detection**: Euclidean distance between Landmark **4** (Thumb Tip) and Landmark **8** (Index Tip):
  $$\text{Pinch Distance} = \sqrt{(x_8 - x_4)^2 + (y_8 - y_4)^2}$$
  If $\text{Distance} < \text{Threshold}$ (approx. 0.04 normalized), trigger a **Click/Select** event at index fingertip coordinates.
* **Hover State**: Moving index tip over UI shelves/hotspots displays glowing visual feedback.

### 3.4 Dual-Camera Engine
* **Local Webcam**: Index `0` (built-in laptop or USB webcam via DirectShow `cv2.CAP_DSHOW`).
* **IP Webcam**: Wireless network camera streaming MJPEG/RTSP (e.g., `http://192.168.8.106:8080/video`).
* **Hot-Switch**: Key `[C]` dynamically releases and switches video capture without terminating the process.

### 3.5 Arabic Text & Glassmorphism UI
* OpenCV does not support Arabic text or modern font rendering natively.
* **Pipeline**:
  1. Input Arabic string $\rightarrow$ `arabic_reshaper.reshape()` (joins Arabic glyphs).
  2. Reshaped string $\rightarrow$ `bidi.algorithm.get_display()` (right-to-left layout order).
  3. Overlay rendered on PIL Image using Segoe UI (`segoeui.ttf` / `segoeuib.ttf`).
  4. Converted back to NumPy/OpenCV BGR array and alpha-blended with glassmorphism blur and neon borders.

### 3.6 Hybrid Hardware Acceleration (GPU + CPU Engine)
* **Graphics & Rendering Pipeline**: OpenCV uses **OpenCL GPU Acceleration** (`cv2.ocl.setUseOpenCL(True)`) targeting available discrete/integrated GPUs (e.g. NVIDIA Quadro P2000) for real-time image blending, Gaussian blurs, and affine transformations.
* **AI Landmark Models**: Uses Google's high-performance **XNNPACK Vectorized CPU Engine** (`AVX2/AVX-512/NEON`), which delivers rock-solid 60 FPS inference across all Windows environments without external CUDA/driver dependencies.
* **Graceful Fallback**: At startup, `_init_hardware_acceleration()` probes for available GPU delegates and hardware capabilities, falling back seamlessly without crashing.

### 3.7 High-Precision Background Segmentation & Hand Foreground Shield
* **Sigmoidal Confidence Thresholding**: Cutoff threshold (`seg_threshold = 0.60`, feather = 0.14) with smoothstep roll-off to eliminate furniture/couch background bleed.
* **Skeletal Envelope Gating**: Uses MediaPipe Pose landmarks to clip any background clutter extending horizontally past the torso and shoulders.
* **Hand Foreground Shield**: Automatically renders a convex hull and skeletal bone envelope around all 21 hand landmarks (`hand_lmks_list`) and merges it into the foreground mask:
  $$\text{Mask}_{\text{final}} = \max(\text{Mask}_{\text{person}}, \text{Mask}_{\text{hand}})$$
  This guarantees hands are **100% immune to background subtraction** even when raised high to reach clothes or make air pinch gestures.
* **Live Sensitivity Tuning**: Keys `[` and `]` dynamically adjust `seg_threshold` on the fly.

---

## 4. Foundational Prompts & Principles (How this was engineered)

When modifying or generating new features for this codebase, adhere to these original architectural prompts:

### Principle 1: Real-Time Performance First (60 FPS Target)
> *"All image transformations, alpha blending, and landmark evaluations must run under 16ms per frame. Avoid re-reading disk assets or reloading JSONs during the render loop. Pre-cache all catalog textures and pre-calculate bounding boxes in memory."*

### Principle 2: Graceful Degradation & Fallback
> *"If MediaPipe fails to detect a pose or hand, or if landmark confidence drops below threshold, the application must NEVER crash. Retain the last known valid bounding box with exponential smoothing (EMA) or smoothly fade out the overlay."*

### Principle 3: Premium Glassmorphism & Neon HUD Aesthetics
> *"The visual interface must feel like a futuristic smart mirror. Use dark slate semi-transparent backdrops (`rgba(15, 23, 42, 0.75)`), vibrant neon cyan/emerald accents (`#00f5d4`, `#38bdf8`), rounded corner cards, glowing status dots, and crisp Arabic typography. No raw OpenCV default fonts (no `cv2.putText` with Hershey fonts)."*

### Principle 4: Spatial UI Mapping
> *"The user interface elements are not just flat overlays; they are aligned with the 3D dressing room walls. When the camera or head pans, spatial item hotspots shift accordingly."*

---

## 5. Developer & Agent Cheat Sheet (Quick Modifications)

### Adding a New Item to the Catalog:
1. Save the transparent PNG asset into `things_assets/<category>/<item_id>.png`.
2. Create the matching JSON configuration `things_assets/<category>/<item_id>.json`:
   ```json
   {
     "id": "suite_99",
     "category": "suite",
     "type": "suit",
     "title": "بدلة كلاسيكية سوداء",
     "url": "things_assets/suite/suite_99.png",
     "width": 736,
     "height": 1083,
     "keypoints": {
       "12": [0.25, 0.15],
       "11": [0.75, 0.15]
     }
   }
   ```
3. Add the item entry into `things_assets/catalog.json` under its category array.

### Adjusting Head-Tracking Sensitivity:
* In `run_ar_studio.py`, find `head_yaw` calculation inside `ARStudioEngine.process_frame()`.
* Modify the sensitivity multiplier (default: $\approx 1.8$ to $2.5$) or the smoothing factor in the EMA filter:
  ```python
  self.smoothed_yaw = (1 - alpha) * self.smoothed_yaw + alpha * raw_yaw
  ```

### Adjusting Pinch Detection Sensitivity:
* In `run_ar_studio.py` (or `web_ar/js/gesture_controller.js`):
* Look for `PINCH_THRESHOLD`. Default normalized distance is `0.042`. Increase for easier triggers, decrease to prevent accidental clicks.

---

## 6. Keyboard & Interaction Controls Reference

| Key | Action | Description |
|:---:|:---|:---|
| `[R]` | **Reset Calibration** | Centers head yaw and locks camera viewport to center wall |
| `[B]` | **Toggle Background** | Cycles: 3-Wall Room $\rightarrow$ Smart Blur $\rightarrow$ Raw Camera Feed |
| `[` / `]` | **Tune Cutout Strictness** | `[` broadens segmentation, `]` strictly clips background furniture |
| `[G]` | **Toggle Gestures** | Enables / disables hand landmark tracking & air gestures |
| `[C]` | **Toggle Camera** | Switches between Local Laptop Webcam and IP Webcam |
| `[1]` - `[8]` | **Quick Shelf Access** | Opens category shelves and navigates to corresponding wall |
| `[S]` | **Take Snapshot** | Captures high-res photo with watermark into `snapshots/` |
| `[X]` | **Clear All** | Removes all currently worn items and accessories |
| `[F]` | **Fullscreen** | Toggles borderless fullscreen mode |
| `[Q]` / `[ESC]` | **Quit** | Gracefully releases camera, models, and destroys windows |

---

## 7. Known Nuances & Gotchas for AI Agents

1. **MediaPipe Model Paths**:
   - `models/*.task` files are binary model bundles required by `mediapipe.tasks.python.vision`.
   - Never use relative paths that assume the current working directory is the script folder; always use `Path(__file__).resolve().parent / "models"`.
2. **Color Channel Order**:
   - OpenCV uses **BGR**. PIL uses **RGB**.
   - MediaPipe Tasks API expects `mp.ImageFormat.SRGB`. Always convert frames using `cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)` before passing to MediaPipe.
3. **Windows UTF-8 Encoding**:
   - Arabic logging in terminal requires `sys.stdout.reconfigure(encoding="utf-8")` to avoid `UnicodeEncodeError` on Windows `cp1256` or `cp437`.

---

## 8. سجل القرارات المعمارية وتطوير الميزات (Chronological Discussion & Decisions Log)

توثيق كامل لكافة التوجيهات، المناقشات، والقرارات الفنية التي تمت مع المستخدم لضمان فهم أي مطور أو وكيل ذكاء اصطناعي (AI Agent) لمسار القرارات بدقة:

### 8.1 تركيب الملابس الحقيقية على جدران البوتيك (Panorama Real Asset Synthesis)
* **الطلب والمناقشة:** رغبة المستخدم في رؤية الملابس الحقيقية الموجودة في المشروع معلقة بدقة على جدران الغرفة الافتراضية مع الحفاظ على جمالية الغرفة الفاخرة، الإضاءة الخافتة، والأرضيات الخشبية.
* **الحل المنفذ:** 
  - بناء سكريبت متقدم `things_assets/backgrounds/build_panorama.py` يقوم بدمج 25 قطعة ملابس وإكسسوارات حقيقية على الجدران الثلاثة بتأثيرات ظلال واقعية وشماعات فاخرة.
  - استخراج إحداثيات بكسلية مطابقة 100% في ملف `spatial_hotspots.json` وتحميلها ديناميكياً داخل `run_ar_studio.py`.

### 8.2 ضبط ودقة قص الخلفية (High-Precision Background Cutout)
* **الطلب والمناقشة:** كيف نجعل قص الخلفية أكثر دقة؟ مع إزالة أي تشويش أو أثاث خلفي (مثل الكنبة خلف المستخدم).
* **الحل المنفذ:** 
  - حل مشكلة تباين أبعاد مصفوفة الماسك `(480, 640, 1)` إلى `(480, 640)`.
  - تطبيق معادلة تدرج حادة ونقية (Smoothstep Sigmoid) مع رفع عتبة الثقة إلى `0.60`.
  - توفير مفاتيح تفاعلية فورية `[` و `]` في لوحة المفاتيح لزيادة أو تضييق دقة القص لحظياً أثناء البث المباشر.

### 8.3 المعالجة الهجينة بين كرت الشاشة والمعالج (Hybrid GPU/CPU Auto-Detection)
* **الطلب والمناقشة:** هل يعمل النظام على GPU أم CPU؟ وهل يمكن للنظام فحص العتاد عند الإقلاع والربط بالـ GPU إن وُجد أو التحويل بسلاسة إلى CPU؟
* **الحل المنفذ:** 
  - تفعيل `_init_hardware_acceleration()` عند بداية التشغيل.
  - فحص كرت الشاشة المنفصل (NVIDIA Quadro P2000) وربطه مع معالجات الرسوميات في OpenCV عبر تقنية OpenCL GPU.
  - فحص محرك MediaPipe واستخدام معمارية XNNPACK CPU عالية الأداء مع تفادي أي توقف أو رسائل خطأ، لضمان استقرار 60 إطار في الثانية دائماً.

### 8.4 منع القفزات اللحظية في حركة الجدران (Pure Nose/Head Tracking - No Gaze Jumps)
* **الطلب والمناقشة:** ظهور قفزات مفاجئة وسريعة عند الالتفات يميناً ويساراً بين الجدران؛ والمناقشة حول هل نعتمد على حركة العينين أم الأنف.
* **القرار المتفق عليه:** **الاعتماد التام على الأنف وتدوير الرأس (Pure Nose & Head Tracking).**
* **الحل المنفذ:** إلغاء حسابات بؤبؤ العين (Eye Iris Saccades) التي كانت تسبب رجفان المشهد عند حركة العين الطبيعية، وتثبيت التتبع على إحداثيات أرنبة الأنف (Landmark 1) بالنسبة للخدين مع إضافة منطقة ارتكاز ميتة (Deadband) وتنعيم حركي انسيابي (Gimbal Exponential Damping).

### 8.5 درع حماية اليد من الاختفاء (Hand Foreground Shield)
* **الطلب والمناقشة:** عند محاولة رفع اليد لأخذ بدلة من الجدار، يواجه المستخدم صعوبة لأن نظام عزل الخلفية يعتبر اليد أحياناً جزءاً من الخلفية فيقوم بمسحها أو قطعها.
* **الحل المنفذ:** 
  - ابتكار نظام "درع اليد" (`hand_shield`) داخل دالة عزل الخلفية.
  - بمجرد رصد معالم اليد من MediaPipe، يتم توليد قناع حماية يغطي هيكل اليد وعظام الأصابع مع توسيع بمقدار 25 بكسل ودمج الغلاف المحدب (Convex Hull).
  - دمج قناع اليد كطبقة أمامية دائمة (`np.maximum(crisp_mask, hand_shield)`) مما يجعل اليد محصنة 100% ضد القص وتظهر دائماً فوق كل العناصر والجدران.
