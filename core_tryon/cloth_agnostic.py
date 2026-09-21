"""
================================================================================
VisionCraft - Cloth Agnostic & Old Garment Eraser Engine
محرك تحييد الجذع ومسح الملابس القديمة (Cloth-Agnostic Representation)
مستوحى من شبكات SCHP و VITON-HD لمنع تداخل ياقة الملابس القديمة
================================================================================
"""

import cv2
import numpy as np

def generate_agnostic_torso(base_img: np.ndarray, landmarks: dict) -> tuple[np.ndarray, np.ndarray]:
    """
    تحييد منطقة الصدر والياقة القديمة للشخص لمنع ظهورها أسفل البدلة أو الفستان الجديد
    مستوحى من تمثيل Agnostic Body في أبحاث Virtual Try-On
    Returns:
        (neutralized_image, agnostic_mask)
    """
    img_h, img_w = base_img.shape[:2]
    mask = np.zeros((img_h, img_w), dtype=np.uint8)

    has_shoulders = "left_shoulder" in landmarks and "right_shoulder" in landmarks
    if not has_shoulders:
        return base_img.copy(), mask

    # 1. استخراج الإحداثيات
    s1 = landmarks["left_shoulder"]
    s2 = landmarks["right_shoulder"]
    sx1, sy1 = float(s1[0]) * img_w, float(s1[1]) * img_h
    sx2, sy2 = float(s2[0]) * img_w, float(s2[1]) * img_h

    if sx1 <= sx2:
        lsx, lsy = sx1, sy1
        rsx, rsy = sx2, sy2
    else:
        lsx, lsy = sx2, sy2
        rsx, rsy = sx1, sy1

    sh_dist = np.hypot(rsx - lsx, rsy - lsy)
    mid_sh_x = (lsx + rsx) / 2.0
    mid_sh_y = (lsy + rsy) / 2.0

    # 2. تحديد قاع الرقبة أسفل الذقن
    if "chin" in landmarks:
        chin_x = float(landmarks["chin"][0]) * img_w
        chin_y = float(landmarks["chin"][1]) * img_h
        neck_y = chin_y + max(12.0, (mid_sh_y - chin_y) * 0.45)
    else:
        neck_y = mid_sh_y - (sh_dist * 0.12)
        chin_x = mid_sh_x

    # 3. بناء مضلع منطقة الصدر والجذع المُراد تحييده
    # نوسع المضلع قليلاً لتغطية الياقة القديمة بالكامل
    torso_poly = np.array([
        [mid_sh_x - (sh_dist * 0.22), neck_y],
        [lsx - (sh_dist * 0.15), lsy + (sh_dist * 0.10)],
        [lsx - (sh_dist * 0.10), mid_sh_y + (sh_dist * 0.85)],
        [rsx + (sh_dist * 0.10), mid_sh_y + (sh_dist * 0.85)],
        [rsx + (sh_dist * 0.15), rsy + (sh_dist * 0.10)],
        [mid_sh_x + (sh_dist * 0.22), neck_y]
    ], dtype=np.int32)

    cv2.fillPoly(mask, [torso_poly], 255)

    # تنعيم حواف القناع
    mask_blurred = cv2.GaussianBlur(mask, (15, 15), 0)
    inpaint_mask = (mask_blurred > 60).astype(np.uint8) * 255

    # 4. تطبيق الترميم الذكي (Inpainting) لتحييد ألوان القميص القديم
    # نستخدم لون متوسط هادئ أو خوارزمية Navier-Stokes
    base_bgr = base_img[:, :, :3] if base_img.shape[2] >= 3 else base_img
    inpainted = cv2.inpaint(base_bgr, inpaint_mask, inpaintRadius=7, flags=cv2.INPAINT_TELEA)

    # دمج خفيف ناعم للحفاظ على طبيعية الصورة
    alpha_mask = (mask_blurred.astype(np.float32) / 255.0)[:, :, np.newaxis]
    neutralized = (inpainted.astype(np.float32) * alpha_mask + base_bgr.astype(np.float32) * (1.0 - alpha_mask)).astype(np.uint8)

    if base_img.shape[2] == 4:
        neutralized = cv2.cvtColor(neutralized, cv2.COLOR_BGR2BGRA)
        neutralized[:, :, 3] = base_img[:, :, 3]

    return neutralized, inpaint_mask
