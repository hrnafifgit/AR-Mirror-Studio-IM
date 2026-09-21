"""
================================================================================
VisionCraft - Thin-Plate Spline (TPS) Elastic Garment Warper Engine
محرك التشويه المرن وثني الأقمشة بالشرائح الرقيقة (TPS)
مستوحى من وحدات GMM في شبكات VTON (Virtual Try-On Networks)
================================================================================
"""

import cv2
import numpy as np
import time

def fit_tps_weights(src_pts: np.ndarray, dst_pts: np.ndarray, reg: float = 1e-3) -> np.ndarray:
    """
    حساب مصفوفة أوزان Thin-Plate Spline (TPS) لربط النقاط المرجعية بالنقاط المستهدفة
    """
    N = len(src_pts)
    P = np.hstack([np.ones((N, 1), dtype=np.float64), src_pts.astype(np.float64)])
    diff = src_pts[:, None, :] - src_pts[None, :, :]
    r2 = np.sum(diff ** 2, axis=-1)
    r = np.sqrt(r2)
    # Radial Basis Function: U(r) = r^2 * log(r)
    K = r2 * np.log(r + 1e-10)
    np.fill_diagonal(K, reg)

    L = np.zeros((N + 3, N + 3), dtype=np.float64)
    L[:N, :N] = K
    L[:N, N:] = P
    L[N:, :N] = P.T

    Y = np.vstack([dst_pts.astype(np.float64), np.zeros((3, 2), dtype=np.float64)])
    try:
        weights = np.linalg.solve(L, Y)
    except np.linalg.LinAlgError:
        weights = np.linalg.lstsq(L, Y, rcond=None)[0]

    return weights


def warp_garment_tps(garment_rgba: np.ndarray, 
                     src_ctrl_pts: np.ndarray, 
                     dst_ctrl_pts: np.ndarray, 
                     out_w: int, 
                     out_h: int, 
                     grid_steps: int = 32) -> np.ndarray:
    """
    تطبيق التحويل المرن (TPS Warping) على صورة اللباس المفرغة (RGBA)
    مع الحفاظ الدقيق على الشفافية وتنعيم الحواف
    """
    # الخريطة العكسية (Backward Mapping): من إحداثيات الهدف إلى إحداثيات اللباس الأصلي
    weights = fit_tps_weights(dst_ctrl_pts, src_ctrl_pts)
    
    gx, gy = np.meshgrid(
        np.linspace(0, out_w - 1, grid_steps, dtype=np.float64),
        np.linspace(0, out_h - 1, grid_steps, dtype=np.float64)
    )
    grid_pts = np.column_stack([gx.ravel(), gy.ravel()])
    N = len(dst_ctrl_pts)
    
    diff = grid_pts[:, None, :] - dst_ctrl_pts[None, :, :]
    r2 = np.sum(diff ** 2, axis=-1)
    r = np.sqrt(r2)
    K = r2 * np.log(r + 1e-10)
    P = np.hstack([np.ones((len(grid_pts), 1), dtype=np.float64), grid_pts])
    
    mapped = np.dot(K, weights[:N]) + np.dot(P, weights[N:])
    
    map_x_low = mapped[:, 0].reshape((grid_steps, grid_steps)).astype(np.float32)
    map_y_low = mapped[:, 1].reshape((grid_steps, grid_steps)).astype(np.float32)
    
    # استيفاء تكعيبي للشبكة الكثيفة بدقة متناهية
    map_x = cv2.resize(map_x_low, (out_w, out_h), interpolation=cv2.INTER_CUBIC)
    map_y = cv2.resize(map_y_low, (out_w, out_h), interpolation=cv2.INTER_CUBIC)
    
    warped = cv2.remap(
        garment_rgba,
        map_x,
        map_y,
        interpolation=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0)
    )
    return warped


def get_template_control_points(garment_w: float, garment_h: float) -> np.ndarray:
    """
    توليد نقاط التحكم المرجعية التشريحية لقطعة الملابس (14 نقطة تماسك هيكلي)
    """
    w, h = float(garment_w), float(garment_h)
    pts = [
        # الياقة ومنخفض الرقبة
        [w * 0.50, h * 0.035], # 0: مركز الياقة
        [w * 0.38, h * 0.050], # 1: كتف الياقة الأيسر
        [w * 0.62, h * 0.050], # 2: كتف الياقة الأيمن
        # الأكتاف الخارجية
        [w * 0.08, h * 0.120], # 3: طرف الكتف الأيسر
        [w * 0.92, h * 0.120], # 4: طرف الكتف الأيمن
        # منطقة الصدر والإبطين
        [w * 0.15, h * 0.380], # 5: إبط أيسر
        [w * 0.85, h * 0.380], # 6: إبط أيمن
        [w * 0.50, h * 0.380], # 7: منتصف الصدر
        # الخصر والبطن
        [w * 0.18, h * 0.680], # 8: خصر أيسر
        [w * 0.82, h * 0.680], # 9: خصر أيمن
        [w * 0.50, h * 0.680], # 10: منتصف الخصر
        # الحافة السفلية
        [w * 0.12, h * 0.980], # 11: أسفل يسار
        [w * 0.88, h * 0.980], # 12: أسفل يمين
        [w * 0.50, h * 0.980]  # 13: أسفل منتصف
    ]
    return np.array(pts, dtype=np.float64)


def map_body_target_points(landmarks: dict, 
                            img_w: int, 
                            img_h: int, 
                            garment_aspect: float, 
                            scale_mult: float = 1.65, 
                            offset_y: float = 0.0) -> np.ndarray:
    """
    حساب المواضع الهدف المقابلة على جسم الشخص اعتماداً على نقاط Pose و FaceMesh
    """
    # 1. فحص نقاط الأكتاف
    has_shoulders = "left_shoulder" in landmarks and "right_shoulder" in landmarks
    if has_shoulders:
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
    else:
        # افتراضي إذا لم تتوفر نقاط الكتفين
        sh_span = img_w * 0.35
        lsx, lsy = (img_w * 0.5) - (sh_span / 2), img_h * 0.35
        rsx, rsy = (img_w * 0.5) + (sh_span / 2), img_h * 0.35

    sh_dist = np.hypot(rsx - lsx, rsy - lsy)
    sh_angle = np.arctan2(rsy - lsy, rsx - lsx)
    mid_sh_x = (lsx + rsx) / 2.0
    mid_sh_y = (lsy + rsy) / 2.0

    # 2. تحديد موضع الياقة التشريحية (Suprasternal Notch)
    if "chin" in landmarks:
        chin_y = float(landmarks["chin"][1]) * img_h
        neck_base_y = chin_y + max(10.0, (mid_sh_y - chin_y) * 0.42)
    else:
        neck_base_y = mid_sh_y - (sh_dist * 0.12)

    neck_base_y += offset_y

    # 3. الأكتاف العريضة الفيزيائية للبدلة
    suit_half_span = (sh_dist * scale_mult) / 2.0
    cos_a = np.cos(sh_angle)
    sin_a = np.sin(sh_angle)

    left_outer_sh_x = mid_sh_x - (suit_half_span * cos_a)
    left_outer_sh_y = mid_sh_y - (suit_half_span * sin_a)
    right_outer_sh_x = mid_sh_x + (suit_half_span * cos_a)
    right_outer_sh_y = mid_sh_y + (suit_half_span * sin_a)

    # 4. الياقة والكتفين القريبين
    collar_half = sh_dist * 0.26
    left_collar_x = mid_sh_x - (collar_half * cos_a)
    left_collar_y = neck_base_y - (collar_half * sin_a)
    right_collar_x = mid_sh_x + (collar_half * cos_a)
    right_collar_y = neck_base_y + (collar_half * sin_a)

    # 5. نقاط الصدر والإبطين
    total_suit_h = (sh_dist * scale_mult) * garment_aspect
    chest_y = neck_base_y + (total_suit_h * 0.35)
    chest_half = suit_half_span * 0.88

    left_armpit_x = mid_sh_x - (chest_half * cos_a)
    left_armpit_y = chest_y - (chest_half * sin_a)
    right_armpit_x = mid_sh_x + (chest_half * cos_a)
    right_armpit_y = chest_y + (chest_half * sin_a)

    # 6. نقاط الخصر والوركين
    has_hips = "left_hip" in landmarks and "right_hip" in landmarks
    if has_hips:
        h1 = landmarks["left_hip"]
        h2 = landmarks["right_hip"]
        hip_mid_y = (float(h1[1]) + float(h2[1])) / 2.0 * img_h
        waist_y = mid_sh_y + (hip_mid_y - mid_sh_y) * 0.55
    else:
        waist_y = neck_base_y + (total_suit_h * 0.65)

    waist_half = suit_half_span * 0.82
    left_waist_x = mid_sh_x - (waist_half * cos_a)
    left_waist_y = waist_y - (waist_half * sin_a)
    right_waist_x = mid_sh_x + (waist_half * cos_a)
    right_waist_y = waist_y + (waist_half * sin_a)

    # 7. الحافة السفلية
    bottom_y = neck_base_y + total_suit_h
    bot_half = suit_half_span * 0.86
    bot_left_x = mid_sh_x - (bot_half * cos_a)
    bot_left_y = bottom_y - (bot_half * sin_a)
    bot_right_x = mid_sh_x + (bot_half * cos_a)
    bot_right_y = bottom_y + (bot_half * sin_a)

    target_pts = [
        [mid_sh_x, neck_base_y],               # 0: مركز الياقة
        [left_collar_x, left_collar_y],       # 1: ياقة يسار
        [right_collar_x, right_collar_y],     # 2: ياقة يمين
        [left_outer_sh_x, left_outer_sh_y],   # 3: كتف أيسر خارجي
        [right_outer_sh_x, right_outer_sh_y], # 4: كتف أيمن خارجي
        [left_armpit_x, left_armpit_y],       # 5: إبط أيسر
        [right_armpit_x, right_armpit_y],     # 6: إبط أيمن
        [mid_sh_x, chest_y],                  # 7: منتصف الصدر
        [left_waist_x, left_waist_y],         # 8: خصر أيسر
        [right_waist_x, right_waist_y],       # 9: خصر أيمن
        [mid_sh_x, waist_y],                  # 10: منتصف الخصر
        [bot_left_x, bot_left_y],             # 11: أسفل يسار
        [bot_right_x, bot_right_y],           # 12: أسفل يمين
        [mid_sh_x, bottom_y]                  # 13: أسفل منتصف
    ]
    return np.array(target_pts, dtype=np.float64)
