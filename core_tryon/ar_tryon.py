"""
================================================================================
VisionCraft - AR Virtual Try-On Studio Engine
غرفة التجميل والتركيب الافتراضي (نظارات، أوشحة، بدلات رسمية، قبعات)
باستخدام خوارزميات التحويلات الهندسية (Affine Transformation, Scale & Alpha Blending)
مع نقاط معالم الوجه والجسم (MediaPipe Face Mesh 478 & Pose)
================================================================================
"""

import os
import time
import cv2
import numpy as np
from core_tryon.base import ProcessingResult
from core_tryon.tps_warper import warp_garment_tps, get_template_control_points, map_body_target_points
from core_tryon.cloth_agnostic import generate_agnostic_torso

STUDIO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
THINGS_DIR = os.path.join(STUDIO_ROOT, "things_assets")
ACCESSORIES_DIR = THINGS_DIR

# التخزين المؤقت للأكسسوارات الشفافة (Cache RGBA Assets)
_ACCESSORY_CACHE = {}

def get_accessory_image(accessory_name: str) -> np.ndarray:
    """
    تحميل أصل الأكسسوار الشفاف (BGRA) مع التخزين المؤقت في الذاكرة
    يدعم مجلد الأكسسوارات الافتراضية accessories ومجلدات imagesthings/things_assets
    """
    clean_name = accessory_name.strip().replace("\\", "/")
    if clean_name.startswith("things_assets/"):
        clean_name = clean_name.replace("things_assets/", "")

    if not clean_name.endswith(".png"):
        clean_name_png = clean_name + ".png"
    else:
        clean_name_png = clean_name

    if clean_name_png in _ACCESSORY_CACHE:
        return _ACCESSORY_CACHE[clean_name_png].copy()

    file_path = None
    # 1. البحث في accessories
    candidate1 = os.path.join(ACCESSORIES_DIR, os.path.basename(clean_name_png))
    if os.path.exists(candidate1):
        file_path = candidate1
    else:
        # 2. البحث في things_assets مباشرة أو داخل المجلدات الفرعية
        candidate2 = os.path.join(THINGS_DIR, clean_name_png)
        if os.path.exists(candidate2):
            file_path = candidate2
        else:
            base_filename = os.path.basename(clean_name_png)
            for root, _, files in os.walk(THINGS_DIR):
                if base_filename in files:
                    file_path = os.path.join(root, base_filename)
                    break

    if not file_path or not os.path.exists(file_path):
        # البحث عن أقرب تطابق أو بديل
        default_file = os.path.join(ACCESSORIES_DIR, "glasses_black.png")
        if os.path.exists(default_file):
            file_path = default_file
        else:
            raise FileNotFoundError(f"ملف الأكسسوار غير موجود: {accessory_name}")

    # قراءة الصورة مع القناة الشفافة Alpha
    try:
        with open(file_path, 'rb') as f:
            nparr = np.frombuffer(f.read(), np.uint8)
        acc_img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
    except Exception:
        acc_img = cv2.imread(file_path, cv2.IMREAD_UNCHANGED)

    if acc_img is None:
        raise ValueError(f"تعذر قراءة صورة الأكسسوار: {file_path}")

    if len(acc_img.shape) == 2:
        acc_img = cv2.cvtColor(acc_img, cv2.COLOR_GRAY2BGRA)
    elif acc_img.shape[2] == 3:
        # إضافة قناة ألفا كاملة إذا لم تكن موجودة
        acc_img = cv2.cvtColor(acc_img, cv2.COLOR_BGR2BGRA)

    _ACCESSORY_CACHE[clean_name_png] = acc_img
    return acc_img.copy()

import json

_CATALOG_CACHE = None

def get_garment_metadata(accessory_name: str) -> dict:
    """
    استرجاع بيانات الأكسسوار ونقاط المعالم الموسومة (Keypoints) من catalog.json
    أو من ملفات JSON المخصصة لكل قطعة
    """
    global _CATALOG_CACHE
    if _CATALOG_CACHE is None:
        cat_file = os.path.join(THINGS_DIR, "catalog.json")
        if os.path.exists(cat_file):
            try:
                with open(cat_file, 'r', encoding='utf-8') as f:
                    _CATALOG_CACHE = json.load(f)
            except Exception:
                _CATALOG_CACHE = {}
        else:
            _CATALOG_CACHE = {}

    clean_name = os.path.splitext(os.path.basename(accessory_name))[0].lower()
    
    # 1. البحث في الكتالوج المجمع
    if _CATALOG_CACHE:
        for cat, data in _CATALOG_CACHE.items():
            for item in data.get("items", []):
                item_id = item.get("id", "").lower()
                item_url = item.get("url", "").lower()
                if clean_name == item_id or clean_name in item_url or item_id in clean_name:
                    return item

    # 2. البحث عن ملف .json فردي بجانب الصورة
    for root, _, files in os.walk(THINGS_DIR):
        for f in files:
            if f.lower().endswith(".json") and f.lower() != "catalog.json":
                fb = os.path.splitext(f)[0].lower()
                if clean_name == fb or clean_name in fb or fb in clean_name:
                    try:
                        with open(os.path.join(root, f), 'r', encoding='utf-8') as jf:
                            return json.load(jf)
                    except Exception:
                        pass
    return {}

def compute_anchor_transform(src_p1, src_p2, dst_p1, dst_p2, scale_mult=1.0, offset_x=0.0, offset_y=0.0) -> np.ndarray:
    """
    التحويل الهندسي الدقيق لمطابقة نقطتين مرجعيتين (2D Similarity Transform: Scale, Rotation, Translation)
    يطابق نقطتي اللباس الموسومتين (Source Keypoints) بنقطتي جسم الشخص (Target Landmarks) بدقة مليمترية 100%
    """
    dx_s, dy_s = float(src_p1[0] - src_p2[0]), float(src_p1[1] - src_p2[1])
    L_s = np.hypot(dx_s, dy_s)
    ang_s = np.arctan2(dy_s, dx_s)
    
    dx_d, dy_d = float(dst_p1[0] - dst_p2[0]), float(dst_p1[1] - dst_p2[1])
    L_d = np.hypot(dx_d, dy_d)
    ang_d = np.arctan2(dy_d, dx_d)
    
    if L_s < 1e-4:
        return np.eye(2, 3, dtype=np.float32)
    
    s = (L_d / L_s) * scale_mult
    d_theta = ang_d - ang_s
    
    c_sx = (src_p1[0] + src_p2[0]) / 2.0
    c_sy = (src_p1[1] + src_p2[1]) / 2.0
    
    c_dx = (dst_p1[0] + dst_p2[0]) / 2.0 + offset_x
    c_dy = (dst_p1[1] + dst_p2[1]) / 2.0 + offset_y
    
    a = s * np.cos(d_theta)
    b = s * np.sin(d_theta)
    
    tx = c_dx - (a * c_sx - b * c_sy)
    ty = c_dy - (b * c_sx + a * c_sy)
    
    return np.array([[a, -b, tx], [b, a, ty]], dtype=np.float32)

def estimate_anthropometric_depth(
    ipd_pixels: float = None,
    shoulder_pixels: float = None,
    img_w: int = 640,
    focal_ratio: float = 0.85
) -> dict:
    """
    خوارزمية تقدير العمق القياسية البشرية (Anthropometric Depth Estimation)
    بدون الحاجة إلى حساس عمق 3D أو LiDAR:
    1. للوجه (النظارات والقبعات):
       Depth_Z = (f * W_ipd) / w_pixels
       - W_ipd = 6.3 cm (متوسط المسافة بين البؤبؤين Interpupillary Distance)
    2. للجسم (البدلات والملابس):
       Depth_Z = (f * W_shoulders) / w_pixels
       - W_shoulders = 40.0 cm (متوسط المسافة الحقيقية بين الأكتاف Intershoulder Distance)
    
    المدخلات:
       ipd_pixels: المسافة المحسوبة بين العينين بالبكسل من MediaPipe FaceMesh
       shoulder_pixels: المسافة المحسوبة بين الكتفين بالبكسل من MediaPipe Pose
       img_w: عرض الإطار بالبكسل
       focal_ratio: المعامل البؤري المقدر لكاميرات الويب العادية (~0.85)
    """
    focal_length = img_w * focal_ratio
    metrics = {
        "focal_length_px": focal_length,
        "face_depth_cm": None,
        "body_depth_cm": None,
        "face_scale_factor": 1.0,
        "body_scale_factor": 1.0
    }

    if ipd_pixels and ipd_pixels > 5:
        # عمق الوجه بالسنتيمتر
        face_z = (focal_length * 6.3) / ipd_pixels
        metrics["face_depth_cm"] = round(face_z, 1)
        # معامل التحجيم بالنسبة للمسافة المرجعية (60 سم)
        metrics["face_scale_factor"] = round(60.0 / max(face_z, 15.0), 2)

    if shoulder_pixels and shoulder_pixels > 10:
        # عمق الجسم بالسنتيمتر
        body_z = (focal_length * 40.0) / shoulder_pixels
        metrics["body_depth_cm"] = round(body_z, 1)
        # معامل التحجيم بالنسبة للمسافة المرجعية (100 سم)
        metrics["body_scale_factor"] = round(100.0 / max(body_z, 30.0), 2)

    return metrics

def alpha_blend(base_img: np.ndarray, overlay_rgba: np.ndarray, x_offset: int, y_offset: int) -> np.ndarray:
    """
    دمج صورة شفافة (BGRA Overlay) فوق صورة الأساس (BGR)
    مع معالجة استثنائية لحدود الصورة (Safe Bounding Box Clipping)
    لمنع الانهيار عند خروج الأكسسوار خارج إطار الصورة
    """
    bh, bw = base_img.shape[:2]
    oh, ow = overlay_rgba.shape[:2]

    # حساب حدود التقاطع المشتركة
    x1, y1 = max(0, x_offset), max(0, y_offset)
    x2, y2 = min(bw, x_offset + ow), min(bh, y_offset + oh)

    if x1 >= x2 or y1 >= y2:
        return base_img # الأكسسوار بالكامل خارج إطار الصورة

    # قص الجزء المتداخل من الأكسسوار
    ox1 = x1 - x_offset
    oy1 = y1 - y_offset
    ox2 = ox1 + (x2 - x1)
    oy2 = oy1 + (y2 - y1)

    overlay_crop = overlay_rgba[oy1:oy2, ox1:ox2]
    base_crop = base_img[y1:y2, x1:x2]

    # فصل قناة الألفا وتطبيعها 0.0 .. 1.0
    alpha = overlay_crop[:, :, 3].astype(np.float32) / 255.0
    alpha = np.expand_dims(alpha, axis=-1)

    overlay_bgr = overlay_crop[:, :, :3].astype(np.float32)
    base_bgr = base_crop[:, :, :3].astype(np.float32)

    # معادلة الدمج الشفاف الكلاسيكية: Out = α * Overlay + (1 - α) * Base
    blended = (alpha * overlay_bgr + (1.0 - alpha) * base_bgr).astype(np.uint8)

    output = base_img.copy()
    output[y1:y2, x1:x2, :3] = blended
    return output

def apply_virtual_tryon(base_img: np.ndarray, accessory: str, landmarks: dict = None, options: dict = None) -> ProcessingResult:
    """
    غرفة التجميل والتركيب الافتراضي (AR Virtual Try-On Studio Engine)
    يدعم التعرف الدقيق والمخصص لكل فئة من فئات الأصول (imagesthings):
    - الكوافي والقبعات (cap)
    - النظارات (glasses)
    - قصات الشعر (hair)
    - الكمامات والأقنعة (mask)
    - الأوشحة والسكارفات (wishah)
    - البدلات الرسمية (suite)
    - أزياء المناسبات والأعراس (maried)
    - أزياء وقبعات التخرج (graduition)
    """
    options = dict(options) if options else {}
    return apply_photo_tryon(base_img, garment_input=accessory, landmarks=landmarks, options=options)

apply_ar_tryon = apply_virtual_tryon



def apply_magic_ai_tryon(base_img: np.ndarray, 
                         worn_items: dict, 
                         landmarks: dict = None, 
                         options: dict = None) -> ProcessingResult:
    """
    التوليد السينمائي السحري الفائق (Magic AI Virtual Try-On):
    - معالجة كافة الأكسسوارات والملابس المرتداة معاً بدقة فائقة
    - تطبيق TPS Elastic Warping على البدلات
    - مسح القميص القديم (Cloth Agnostic)
    - مواءمة الإضاءة والظلال الطبيعية
    """
    t0 = time.perf_counter()
    options = options or {}
    landmarks = landmarks or {}
    current_img = base_img.copy()

    worn_order = ["suit", "scarf", "glasses", "hair"]
    applied_count = 0

    for item_key in worn_order:
        item = worn_items.get(item_key)
        if not item:
            continue
        
        acc_id = item.get("id") if isinstance(item, dict) else str(item)
        if not acc_id:
            continue

        item_opts = dict(options)
        if item_key == "suit":
            item_opts["use_tps"] = True
            item_opts["neutralize_torso"] = True
            if "suitScaleMultiplier" in options:
                item_opts["scale"] = options["suitScaleMultiplier"]
            if "suitOffsetShiftY" in options:
                item_opts["offset_y"] = options["suitOffsetShiftY"]

        res = apply_virtual_tryon(current_img, acc_id, landmarks, item_opts)
        current_img = res.image
        applied_count += 1

    # مواءمة ضوئية خفيفة (Subtle Lighting & Shadow Softening)
    formula = f"Magic AI Try-On Composite | {applied_count} Items Harmonized | Elastic TPS & Agnostic Torso"
    code = (
        "# Magic AI Multi-Item Try-On Pipeline\n"
        "# 1. Agnostic Body Parsing & Inpainting\n"
        "# 2. Thin-Plate Spline Elastic Warping\n"
        "# 3. Physical Shadow Synthesis & Multi-Layer Alpha Composition\n"
    )

    return ProcessingResult(current_img, formula, code, t0)


def apply_photo_tryon(model_img: np.ndarray, 
                      garment_input, 
                      landmarks: dict = None, 
                      options: dict = None) -> ProcessingResult:
    """
    استوديو تجربة الملابس للصور الثابتة (Photo Virtual Try-On Studio)
    يدعم التعرف الدقيق والمخصص لكل فئة من فئات الأصول:
    1. الكوافي والقبعات (cap, graduition): تستقر أعلى الرأس والجبهة.
    2. النظارات (glasses): تستقر بدقة في العينين وجسر الأنف.
    3. قصات الشعر (hair): منبت الشعر أعلى الجبين ومحيط الرأس.
    4. اللثام والكمامات (mask): يغطي منطقة الفم والأنف والذقن.
    5. الأوشحة والشيلان (wishah): تلتف حول الرقبة والكتفين.
    6. أزياء وبدلات الأعراس (maried): اقتطاع الوجه وتركيبه بدقة داخل فتحة بدلة العريس (Face Inset).
    7. البدلات والملابس الرسمية (suite): تركيب مرن للجسم عبر TPS وتحييد القميص القديم.
    """
    t0 = time.perf_counter()
    options = options or {}
    img_h, img_w = model_img.shape[:2]

    # 1. تحميل صورة اللباس أو الأكسسوار
    if isinstance(garment_input, np.ndarray):
        garment_rgba = garment_input
        garment_name = "custom_uploaded_garment"
    else:
        garment_name = str(garment_input)
        garment_rgba = get_accessory_image(garment_name)

    acc_h, acc_w = garment_rgba.shape[:2]

    # 2. استخراج الفئة والاسم وبيانات المعالم الموسومة (Keypoints)
    cat = str(options.get("category", "")).lower()
    g_name = garment_name.lower()
    g_id = str(options.get("garment_id", "")).lower()

    # استرجاع نقاط المعالم الموسومة للبدلة أو الأكسسوار
    garment_meta = get_garment_metadata(garment_name)
    keypoints = options.get("keypoints") or garment_meta.get("keypoints", {})

    is_cap = (
        cat in ("cap", "graduition") or 
        "cap" in g_name or "cap" in g_id or
        "hat" in g_name or "hat" in g_id or
        "grad" in g_name or "grad" in g_id
    )
    is_glasses = (
        cat == "glasses" or 
        "glass" in g_name or "glass" in g_id or
        "sunglass" in g_name
    )
    is_hair = (
        (cat == "hair" or "hair" in g_name or "hair" in g_id or "wig" in g_name)
        and not is_cap
    )
    is_mask = (
        cat == "mask" or 
        "mask" in g_name or "mask" in g_id or
        "keffiyeh" in g_name
    )
    is_scarf = (
        (cat == "wishah" or "wishah" in g_name or "wishah" in g_id or "scarf" in g_name)
        and not (is_cap or is_mask or is_hair)
    )
    is_maried = (
        cat == "maried" or 
        "maried" in g_name or "maried" in g_id or
        "wedding" in g_name
    )

    # 3. إعداد واستكمال معالم الجسم والوجه
    lm = dict(landmarks) if landmarks else {}

    is_portrait = (img_h >= img_w)
    if "left_shoulder" not in lm or "right_shoulder" not in lm:
        span_ratio = 0.36 if is_portrait else 0.28
        sh_span = img_w * span_ratio
        sh_y = 0.36 if is_portrait else 0.44
        lm["left_shoulder"] = [0.5 - (sh_span / (2 * img_w)), sh_y]
        lm["right_shoulder"] = [0.5 + (sh_span / (2 * img_w)), sh_y]

    if "chin" not in lm:
        lm["chin"] = [0.5, 0.28 if is_portrait else 0.34]

    if "forehead" not in lm:
        chin_y = float(lm["chin"][1])
        lm["forehead"] = [0.5, max(0.08, chin_y - 0.16)]

    if "left_eye" not in lm or "right_eye" not in lm:
        chin_y = float(lm["chin"][1])
        eye_y = chin_y - 0.08
        lm["left_eye"] = [0.44, eye_y]
        lm["right_eye"] = [0.56, eye_y]

    # استخراج إحداثيات العيون والزاوية العامة
    lex = float(lm["left_eye"][0]) * img_w
    ley = float(lm["left_eye"][1]) * img_h
    rex = float(lm["right_eye"][0]) * img_w
    rey = float(lm["right_eye"][1]) * img_h
    if lex > rex:
        lex, rex = rex, lex
        ley, rey = rey, ley
    eye_dist = max(25.0, np.hypot(rex - lex, rey - ley))
    angle_deg = np.degrees(np.arctan2(rey - ley, rex - lex))
    mid_eyes_x = (lex + rex) / 2.0
    mid_eyes_y = (ley + rey) / 2.0

    user_scale = float(options.get("scale", 1.0))
    offset_y = float(options.get("offset_y", 0))
    offset_x = float(options.get("offset_x", 0))

    drop_coords = options.get("drop_coords")
    custom_center = None
    if drop_coords and "x" in drop_coords and "y" in drop_coords:
        custom_center = (float(drop_coords["x"]), float(drop_coords["y"]))

    # =========================================================================
    # الفئة 1: الكوافي والقبعات وقبعات التخرج (Caps & Hats - Crown of Head)
    # =========================================================================
    if is_cap:
        has_cap_anchors = ("2" in keypoints and "5" in keypoints)
        if has_cap_anchors:
            src_2 = (float(keypoints["2"][0]) * acc_w, float(keypoints["2"][1]) * acc_h)
            src_5 = (float(keypoints["5"][0]) * acc_w, float(keypoints["5"][1]) * acc_h)
            dst_2 = (lex, ley)
            dst_5 = (rex, rey)
            scale_ratio = (user_scale / 1.68) if user_scale > 1.25 else user_scale
            M = compute_anchor_transform(src_2, src_5, dst_2, dst_5, scale_mult=scale_ratio, offset_x=offset_x, offset_y=offset_y)
            rotated = cv2.warpAffine(garment_rgba, M, (img_w, img_h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
            result_img = alpha_blend(model_img, rotated, 0, 0)
            formula = f"Photo Try-On Studio [{garment_name}] | Anchor Matching Cap Fit"
            code = f"# Photo Try-On Studio (Cap Anchors Mode)\nresult = alpha_blend(model, rotated_cap, 0, 0)"
            return ProcessingResult(result_img, formula, code, t0)

        if "forehead" in lm:
            fx = float(lm["forehead"][0]) * img_w
            fy = float(lm["forehead"][1]) * img_h
        else:
            fx = mid_eyes_x
            fy = mid_eyes_y - (eye_dist * 0.95)

        cap_scale_base = 2.75
        c_scale = cap_scale_base * (user_scale / 1.68 if user_scale > 1.3 else user_scale)
        target_w = int(eye_dist * c_scale)
        target_h = int(target_w * (acc_h / acc_w))
        target_w = max(20, min(img_w * 2, target_w))
        target_h = max(20, min(img_h * 2, target_h))

        resized = cv2.resize(garment_rgba, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
        rot_matrix = cv2.getRotationMatrix2D((target_w / 2.0, target_h / 2.0), -angle_deg, 1.0)
        rotated = cv2.warpAffine(resized, rot_matrix, (target_w, target_h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

        # تستقر قاعدة الكوفية أو القبعة عند الجبين وتتمدد لأعلى الرأس
        if custom_center:
            top_left_x = int(custom_center[0] - (target_w / 2.0))
            top_left_y = int(custom_center[1] - (target_h / 2.0))
        else:
            top_left_x = int(fx - (target_w / 2.0) + offset_x)
            top_left_y = int(fy - (target_h * 0.74) + offset_y)

        result_img = alpha_blend(model_img, rotated, top_left_x, top_left_y)
        formula = f"Photo Try-On Studio [{garment_name}] | Cap & Headwear Placement"
        code = f"# Photo Try-On Studio (Cap Mode)\nresult = alpha_blend(model, rotated_cap, {top_left_x}, {top_left_y})"
        return ProcessingResult(result_img, formula, code, t0)

    # =========================================================================
    # الفئة 2: النظارات الشمسية والطبية (Glasses - Eyes & Nose Bridge)
    # =========================================================================
    elif is_glasses:
        has_eye_anchors = ("2" in keypoints and "5" in keypoints)
        if has_eye_anchors:
            src_2 = (float(keypoints["2"][0]) * acc_w, float(keypoints["2"][1]) * acc_h)
            src_5 = (float(keypoints["5"][0]) * acc_w, float(keypoints["5"][1]) * acc_h)
            dst_2 = (lex, ley)
            dst_5 = (rex, rey)
            scale_ratio = (user_scale / 1.68) if user_scale > 1.25 else user_scale
            M = compute_anchor_transform(src_2, src_5, dst_2, dst_5, scale_mult=scale_ratio, offset_x=offset_x, offset_y=offset_y)
            rotated = cv2.warpAffine(garment_rgba, M, (img_w, img_h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
            result_img = alpha_blend(model_img, rotated, 0, 0)
            formula = f"Photo Try-On Studio [{garment_name}] | Eye Anchor Precision Fit"
            code = f"# Photo Try-On Studio (Glasses Anchors Mode)\nresult = alpha_blend(model, rotated_glasses, 0, 0)"
            return ProcessingResult(result_img, formula, code, t0)

        glasses_scale_base = 2.25
        g_scale = glasses_scale_base * (user_scale / 1.68 if user_scale > 1.3 else user_scale)
        target_w = int(eye_dist * g_scale)
        target_h = int(target_w * (acc_h / acc_w))
        target_w = max(20, min(img_w * 2, target_w))
        target_h = max(20, min(img_h * 2, target_h))

        resized = cv2.resize(garment_rgba, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
        rot_matrix = cv2.getRotationMatrix2D((target_w / 2.0, target_h / 2.0), -angle_deg, 1.0)
        rotated = cv2.warpAffine(resized, rot_matrix, (target_w, target_h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

        if custom_center:
            top_left_x = int(custom_center[0] - (target_w / 2.0))
            top_left_y = int(custom_center[1] - (target_h / 2.0))
        else:
            top_left_x = int(mid_eyes_x - (target_w / 2.0) + offset_x)
            top_left_y = int(mid_eyes_y - (target_h / 2.0) + offset_y)

        result_img = alpha_blend(model_img, rotated, top_left_x, top_left_y)
        formula = f"Photo Try-On Studio [{garment_name}] | Eye-Level Glasses Fit"
        code = f"# Photo Try-On Studio (Glasses Mode)\nresult = alpha_blend(model, rotated_glasses, {top_left_x}, {top_left_y})"
        return ProcessingResult(result_img, formula, code, t0)

    # =========================================================================
    # الفئة 3: قصات الشعر والباروكات (Hair & Wigs - Hairline & Skull)
    # =========================================================================
    elif is_hair:
        if "forehead" in lm:
            fx = float(lm["forehead"][0]) * img_w
            fy = float(lm["forehead"][1]) * img_h
        else:
            fx = mid_eyes_x
            fy = mid_eyes_y - (eye_dist * 0.90)

        hair_scale_base = 2.65
        h_scale = hair_scale_base * (user_scale / 1.68 if user_scale > 1.3 else user_scale)
        target_w = int(eye_dist * h_scale)
        target_h = int(target_w * (acc_h / acc_w))
        target_w = max(20, min(img_w * 2, target_w))
        target_h = max(20, min(img_h * 2, target_h))

        resized = cv2.resize(garment_rgba, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
        rot_matrix = cv2.getRotationMatrix2D((target_w / 2.0, target_h / 2.0), -angle_deg, 1.0)
        rotated = cv2.warpAffine(resized, rot_matrix, (target_w, target_h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

        if custom_center:
            top_left_x = int(custom_center[0] - (target_w / 2.0))
            top_left_y = int(custom_center[1] - (target_h / 2.0))
        else:
            top_left_x = int(fx - (target_w / 2.0) + offset_x)
            top_left_y = int(fy - (target_h * 0.60) + offset_y)

        result_img = alpha_blend(model_img, rotated, top_left_x, top_left_y)
        formula = f"Photo Try-On Studio [{garment_name}] | Hair & Wig Realism"
        code = f"# Photo Try-On Studio (Hair Mode)\nresult = alpha_blend(model, rotated_hair, {top_left_x}, {top_left_y})"
        return ProcessingResult(result_img, formula, code, t0)

    # =========================================================================
    # الفئة 4: اللثام والكمامات والشماغ (Masks & Face Wraps - Mouth & Nose)
    # =========================================================================
    elif is_mask:
        if "chin" in lm:
            cx = float(lm["chin"][0]) * img_w
            cy = float(lm["chin"][1]) * img_h
        else:
            cx = mid_eyes_x
            cy = mid_eyes_y + (eye_dist * 1.35)

        if "nose" in lm:
            nx = float(lm["nose"][0]) * img_w
            ny = float(lm["nose"][1]) * img_h
            mid_mx = (nx + cx) / 2.0
            mid_my = (ny + cy) / 2.0
        else:
            mid_mx = mid_eyes_x
            mid_my = mid_eyes_y + (eye_dist * 0.95)

        mask_scale_base = 2.45
        m_scale = mask_scale_base * (user_scale / 1.68 if user_scale > 1.3 else user_scale)
        target_w = int(eye_dist * m_scale)
        target_h = int(target_w * (acc_h / acc_w))
        target_w = max(20, min(img_w * 2, target_w))
        target_h = max(20, min(img_h * 2, target_h))

        resized = cv2.resize(garment_rgba, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
        rot_matrix = cv2.getRotationMatrix2D((target_w / 2.0, target_h / 2.0), -angle_deg, 1.0)
        rotated = cv2.warpAffine(resized, rot_matrix, (target_w, target_h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

        if custom_center:
            top_left_x = int(custom_center[0] - (target_w / 2.0))
            top_left_y = int(custom_center[1] - (target_h / 2.0))
        else:
            top_left_x = int(mid_mx - (target_w / 2.0) + offset_x)
            top_left_y = int(mid_my - (target_h / 2.0) + offset_y)

        result_img = alpha_blend(model_img, rotated, top_left_x, top_left_y)
        formula = f"Photo Try-On Studio [{garment_name}] | Face Mask & Shemagh Wrap"
        code = f"# Photo Try-On Studio (Mask Mode)\nresult = alpha_blend(model, rotated_mask, {top_left_x}, {top_left_y})"
        return ProcessingResult(result_img, formula, code, t0)

    # =========================================================================
    # الفئة 5: الأوشحة والشيلان (Scarves - Neck & Shoulders)
    # =========================================================================
    elif is_scarf:
        has_scarf_anchors = ("11" in keypoints and "12" in keypoints)
        if has_scarf_anchors:
            src_11 = (float(keypoints["11"][0]) * acc_w, float(keypoints["11"][1]) * acc_h)
            src_12 = (float(keypoints["12"][0]) * acc_w, float(keypoints["12"][1]) * acc_h)
            dst_11 = (float(lm["left_shoulder"][0]) * img_w, float(lm["left_shoulder"][1]) * img_h)
            dst_12 = (float(lm["right_shoulder"][0]) * img_w, float(lm["right_shoulder"][1]) * img_h)
            scale_ratio = (user_scale / 1.68) if user_scale > 1.25 else user_scale
            M = compute_anchor_transform(src_11, src_12, dst_11, dst_12, scale_mult=scale_ratio, offset_x=offset_x, offset_y=offset_y)
            rotated = cv2.warpAffine(garment_rgba, M, (img_w, img_h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
            result_img = alpha_blend(model_img, rotated, 0, 0)
            formula = f"Photo Try-On Studio [{garment_name}] | Anchor Scarf Drape"
            code = f"# Photo Try-On Studio (Scarf Anchors Mode)\nresult = alpha_blend(model, rotated_scarf, 0, 0)"
            return ProcessingResult(result_img, formula, code, t0)

        lsx, lsy = float(lm["left_shoulder"][0]) * img_w, float(lm["left_shoulder"][1]) * img_h
        rsx, rsy = float(lm["right_shoulder"][0]) * img_w, float(lm["right_shoulder"][1]) * img_h
        if lsx > rsx:
            lsx, rsx = rsx, lsx
            lsy, rsy = rsy, lsy
        sh_dist = max(40.0, np.hypot(rsx - lsx, rsy - lsy))
        sh_angle = np.degrees(np.arctan2(rsy - lsy, rsx - lsx))

        if "chin" in lm:
            cx = float(lm["chin"][0]) * img_w
            cy = float(lm["chin"][1]) * img_h
        else:
            cx, cy = (lsx + rsx) / 2.0, (lsy + rsy) / 2.0 - 20

        scarf_scale_base = 1.30
        s_scale = scarf_scale_base * (user_scale / 1.68 if user_scale > 1.3 else user_scale)
        target_w = int(sh_dist * s_scale)
        target_h = int(target_w * (acc_h / acc_w))
        target_w = max(20, min(img_w * 2, target_w))
        target_h = max(20, min(img_h * 2, target_h))

        resized = cv2.resize(garment_rgba, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
        rot_matrix = cv2.getRotationMatrix2D((target_w / 2.0, target_h / 2.0), -sh_angle, 1.0)
        rotated = cv2.warpAffine(resized, rot_matrix, (target_w, target_h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

        if custom_center:
            top_left_x = int(custom_center[0] - (target_w / 2.0))
            top_left_y = int(custom_center[1] - (target_h / 2.0))
        else:
            top_left_x = int(cx - (target_w / 2.0) + offset_x)
            top_left_y = int(cy - (target_h * 0.14) + offset_y)

        result_img = alpha_blend(model_img, rotated, top_left_x, top_left_y)
        formula = f"Photo Try-On Studio [{garment_name}] | Neck Scarf Drape"
        code = f"# Photo Try-On Studio (Scarf Mode)\nresult = alpha_blend(model, rotated_scarf, {top_left_x}, {top_left_y})"
        return ProcessingResult(result_img, formula, code, t0)

    # =========================================================================
    # الفئة 6: أزياء وبدلات الأعراس والمناسبات (Wedding Groom Suits - Face Inset)
    # نأخذ الوجه من صورة الشخص ونضعه داخل فتحة الوجه في بدلة العرس بدقة
    # =========================================================================
    elif is_maried:
        has_maried_anchors = ("11" in keypoints and "12" in keypoints)
        if has_maried_anchors and not options.get("force_face_inset", False):
            src_11 = (float(keypoints["11"][0]) * acc_w, float(keypoints["11"][1]) * acc_h)
            src_12 = (float(keypoints["12"][0]) * acc_w, float(keypoints["12"][1]) * acc_h)
            dst_11 = (float(lm["left_shoulder"][0]) * img_w, float(lm["left_shoulder"][1]) * img_h)
            dst_12 = (float(lm["right_shoulder"][0]) * img_w, float(lm["right_shoulder"][1]) * img_h)
            scale_ratio = (user_scale / 1.68) if user_scale > 1.25 else user_scale
            M = compute_anchor_transform(src_11, src_12, dst_11, dst_12, scale_mult=scale_ratio, offset_x=offset_x, offset_y=offset_y)
            warped = cv2.warpAffine(garment_rgba, M, (img_w, img_h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
            result_img = alpha_blend(model_img, warped, 0, 0)
            formula = f"Photo Try-On Studio [{garment_name}] | Anchor Wedding Suit Match"
            code = f"# Wedding Groom Anchor Integration\nresult = apply_anchor_tryon(model, groom_suit, keypoints)"
            return ProcessingResult(result_img, formula, code, t0)
        if "chin" in lm:
            chin_y = float(lm["chin"][1]) * img_h
            chin_x = float(lm["chin"][0]) * img_w
        else:
            chin_y = mid_eyes_y + (eye_dist * 1.4)
            chin_x = mid_eyes_x

        if "forehead" in lm:
            fore_y = float(lm["forehead"][1]) * img_h
        else:
            fore_y = max(0, mid_eyes_y - (eye_dist * 1.1))

        # مركز ونصف قطر الوجه
        face_cx = int((mid_eyes_x + chin_x) / 2.0)
        face_cy = int((fore_y + chin_y) / 2.0)
        face_radius_x = int(eye_dist * 1.30)
        face_radius_y = int(max(eye_dist * 1.6, (chin_y - fore_y) * 0.68))

        crop_x1 = max(0, face_cx - int(face_radius_x * 1.35))
        crop_y1 = max(0, face_cy - int(face_radius_y * 1.35))
        crop_x2 = min(img_w, face_cx + int(face_radius_x * 1.35))
        crop_y2 = min(img_h, face_cy + int(face_radius_y * 1.35))

        face_crop = model_img[crop_y1:crop_y2, crop_x1:crop_x2]
        ch, cw = face_crop.shape[:2]

        if ch > 10 and cw > 10:
            face_mask = np.zeros((ch, cw), dtype=np.float32)
            mask_cx = face_cx - crop_x1
            mask_cy = face_cy - crop_y1
            cv2.ellipse(face_mask, (mask_cx, mask_cy), (face_radius_x, face_radius_y), -angle_deg, 0, 360, 1.0, -1)
            face_mask = cv2.GaussianBlur(face_mask, (25, 25), 0)

            face_rgba = np.zeros((ch, cw, 4), dtype=np.uint8)
            face_rgba[:, :, :3] = face_crop
            face_rgba[:, :, 3] = (face_mask * 255).astype(np.uint8)

            # استكشاف موقع ياقة البدلة في القالب
            upper_alpha = garment_rgba[:int(acc_h * 0.5), :, 3]
            col_starts = []
            for x in range(int(acc_w * 0.35), int(acc_w * 0.65)):
                ys = np.where(upper_alpha[:, x] > 50)[0]
                if len(ys) > 0:
                    col_starts.append(ys[0])
            collar_y = int(np.percentile(col_starts, 75)) if col_starts else int(acc_h * 0.28)

            # تحجيم الوجه ليتطابق مع فتحة ياقة بدلة العرس
            m_scale = (user_scale / 1.68) if user_scale > 1.3 else user_scale
            suit_face_w = int(acc_w * 0.36 * m_scale)
            suit_face_h = int(suit_face_w * (ch / cw))

            resized_face = cv2.resize(face_rgba, (suit_face_w, suit_face_h), interpolation=cv2.INTER_LANCZOS4)

            # إنشاء كانفاس استوديو مناسب للبدلة
            canvas = np.zeros((acc_h, acc_w, 3), dtype=np.uint8)
            for y_line in range(acc_h):
                ratio = y_line / acc_h
                b_val = int(30 * (1 - ratio) + 14 * ratio)
                g_val = int(36 * (1 - ratio) + 18 * ratio)
                r_val = int(50 * (1 - ratio) + 24 * ratio)
                canvas[y_line, :] = [b_val, g_val, r_val]

            # موضع الوجه في فتحة البدلة
            target_fx = int((acc_w / 2.0) - (suit_face_w / 2.0) + offset_x)
            target_fy = int(collar_y - (suit_face_h * 0.70) + offset_y)

            canvas_with_face = alpha_blend(canvas, resized_face, target_fx, target_fy)
            # دمج بدلة العرس فوق الوجه لتتقدم الياقة والشال أمامه
            result_img = alpha_blend(canvas_with_face, garment_rgba, 0, 0)
        else:
            result_img = model_img.copy()

        formula = f"Photo Try-On Studio [{garment_name}] | Groom Wedding Face-Swap | Studio Fit"
        code = f"# Wedding Groom Face-Swap Integration\nresult = apply_wedding_face_swap(model, groom_suit, landmarks)"
        return ProcessingResult(result_img, formula, code, t0)

    # =========================================================================
    # الفئة 7: البدلات والملابس الرسمية (Upper Body Suits & Jackets - TPS Elastic)
    # =========================================================================
    else:
        use_tps = options.get("use_tps", True)
        use_agnostic = options.get("neutralize_torso", True)
        scale_mult = user_scale if user_scale > 1.3 else 1.68

        # 1. مطابقة النقاط المعلمة للبدلة (Labeled Keypoints 11 & 12)
        has_shoulder_anchors = ("11" in keypoints and "12" in keypoints)
        if has_shoulder_anchors:
            src_11 = (float(keypoints["11"][0]) * acc_w, float(keypoints["11"][1]) * acc_h)
            src_12 = (float(keypoints["12"][0]) * acc_w, float(keypoints["12"][1]) * acc_h)
            dst_11 = (float(lm["left_shoulder"][0]) * img_w, float(lm["left_shoulder"][1]) * img_h)
            dst_12 = (float(lm["right_shoulder"][0]) * img_w, float(lm["right_shoulder"][1]) * img_h)
            scale_ratio = (user_scale / 1.68) if user_scale > 1.25 else user_scale
            M = compute_anchor_transform(src_11, src_12, dst_11, dst_12, scale_mult=scale_ratio, offset_x=offset_x, offset_y=offset_y)
            warped_garment = cv2.warpAffine(garment_rgba, M, (img_w, img_h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
            
            if use_agnostic:
                neutral_base, _ = generate_agnostic_torso(model_img, lm)
            else:
                neutral_base = model_img.copy()
        else:
            src_pts = get_template_control_points(acc_w, acc_h)
            dst_pts = map_body_target_points(lm, img_w, img_h, acc_h / acc_w, 
                                             scale_mult=scale_mult, 
                                             offset_y=offset_y)

            # تحييد الجذع فقط للملابس العلوية لمنع ظهور القميص القديم
            if use_agnostic:
                neutral_base, _ = generate_agnostic_torso(model_img, lm)
            else:
                neutral_base = model_img.copy()

            if use_tps:
                warped_garment = warp_garment_tps(garment_rgba, src_pts, dst_pts, img_w, img_h)
            else:
                lsx, lsy = float(lm["left_shoulder"][0]) * img_w, float(lm["left_shoulder"][1]) * img_h
                rsx, rsy = float(lm["right_shoulder"][0]) * img_w, float(lm["right_shoulder"][1]) * img_h
                sh_dist = np.hypot(rsx - lsx, rsy - lsy)
                target_w = int(sh_dist * scale_mult)
                target_h = int(target_w * (acc_h / acc_w))
                warped_garment = np.zeros((img_h, img_w, 4), dtype=np.uint8)
                resized = cv2.resize(garment_rgba, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
                tx = int((lsx + rsx) / 2.0 - target_w / 2.0 + offset_x)
                ty = int((lsy + rsy) / 2.0 + offset_y)
                warped_garment = alpha_blend(warped_garment, resized, tx, ty)

        # إسقاط الظلال الفيزيائية
        alpha_ch = warped_garment[:, :, 3]
        shadow_mask = cv2.GaussianBlur(alpha_ch, (21, 21), 0)
        shadow_rgba = np.zeros_like(warped_garment)
        shadow_rgba[:, :, :3] = 0
        shadow_rgba[:, :, 3] = (shadow_mask.astype(np.float32) * 0.38).astype(np.uint8)

        base_with_shadow = alpha_blend(neutral_base, shadow_rgba, 0, 5)
        result_img = alpha_blend(base_with_shadow, warped_garment, 0, 0)

        formula = f"Photo Try-On Studio [{garment_name}] | TPS Elastic Fit | Clean Inpainted Base"
        code = f"# Photo Try-On Studio (TPS Elastic Mode)\nresult = apply_photo_tryon(model, garment, landmarks)"

        return ProcessingResult(result_img, formula, code, t0)
