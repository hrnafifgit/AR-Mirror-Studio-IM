#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
================================================================================
VisionCraft AR Studio - Boutique Panorama Room Generator
================================================================================
This script generates a luxury 3-wall panoramic boutique dressing room background
(3600 x 720) that displays the EXACT wearable items from things_assets/.

It preserves:
- The luxury room decor, lighting, spotlights, and warm boutique atmosphere
- The 3-wall architecture (Left: Heritage & Hair, Center: Suits & Formal, Right: Accessories)

It outputs:
1. things_assets/backgrounds/panorama_room_3840.jpg
2. Exact pixel-perfect bounding boxes for spatial_hotspots in run_ar_studio.py
================================================================================
"""

import os
import sys
import json
import math
from pathlib import Path
import cv2
import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent.parent
THINGS_DIR = BASE_DIR / "things_assets"
BG_DIR = THINGS_DIR / "backgrounds"

def get_clean_object(img):
    """Trims transparent margins and removes background noise."""
    if len(img.shape) < 3 or img.shape[2] < 4:
        return img, (0, 0, img.shape[1], img.shape[0])
    alpha = img[:, :, 3]
    contours, _ = cv2.findContours((alpha > 40).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    large = [c for c in contours if cv2.contourArea(c) > 250]
    if not large:
        return img, (0, 0, img.shape[1], img.shape[0])
    pts = np.vstack(large)
    x, y, w, h = cv2.boundingRect(pts)
    clean = img[y:y+h, x:x+w].copy()
    # Mask out any outer noise
    mask = np.zeros((h, w), dtype=np.uint8)
    for c in large:
        cv2.drawContours(mask, [c - [x, y]], -1, 255, -1)
    clean[:, :, 3] = cv2.bitwise_and(clean[:, :, 3], mask)
    return clean, (x, y, w, h)

def alpha_blend(bg, fg, x, y, opacity=1.0):
    """Blends 4-channel fg image onto 3-channel bg image at (x, y)."""
    fh, fw = fg.shape[:2]
    bh, bw = bg.shape[:2]

    # Clip coordinates to background bounds
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(bw, x + fw), min(bh, y + fh)
    if x1 >= x2 or y1 >= y2:
        return

    # Corresponding region in fg
    fx1, fy1 = x1 - x, y1 - y
    fx2, fy2 = fx1 + (x2 - x1), fy1 + (y2 - y1)

    fg_crop = fg[fy1:fy2, fx1:fx2]
    bg_crop = bg[y1:y2, x1:x2]

    alpha = (fg_crop[:, :, 3] / 255.0) * opacity
    alpha_3 = np.repeat(alpha[:, :, np.newaxis], 3, axis=2)

    fg_rgb = fg_crop[:, :, :3]
    blended = (fg_rgb * alpha_3 + bg_crop * (1.0 - alpha_3)).astype(np.uint8)
    bg[y1:y2, x1:x2] = blended

def draw_drop_shadow(bg, fg, x, y, offset=(8, 12), blur_kernel=25, opacity=0.45):
    """Draws a soft realistic drop shadow behind a transparent object."""
    fh, fw = fg.shape[:2]
    alpha = fg[:, :, 3].copy()
    
    # Create shadow canvas with padding
    pad = blur_kernel * 2
    shadow_canvas = np.zeros((fh + pad * 2, fw + pad * 2), dtype=np.uint8)
    shadow_canvas[pad:pad+fh, pad:pad+fw] = (alpha * opacity).astype(np.uint8)
    
    blurred = cv2.GaussianBlur(shadow_canvas, (blur_kernel, blur_kernel), 0)
    
    # Composite shadow onto bg
    sx = x + offset[0] - pad
    sy = y + offset[1] - pad
    
    sh, sw = blurred.shape
    bh, bw = bg.shape[:2]
    
    x1, y1 = max(0, sx), max(0, sy)
    x2, y2 = min(bw, sx + sw), min(bh, sy + sh)
    if x1 >= x2 or y1 >= y2:
        return
        
    bx1, by1 = x1 - sx, y1 - sy
    bx2, by2 = bx1 + (x2 - x1), by1 + (y2 - y1)
    
    b_alpha = (blurred[by1:by2, bx1:bx2] / 255.0)[:, :, np.newaxis]
    bg[y1:y2, x1:x2] = (bg[y1:y2, x1:x2] * (1.0 - b_alpha)).astype(np.uint8)

def build_boutique_panorama():
    print("[*] Starting luxury boutique panorama synthesis...")
    backup_path = BG_DIR / "panorama_room_3840_backup.jpg"
    if not backup_path.exists():
        backup_path = BG_DIR / "panorama_room_3840.jpg"
        
    room = cv2.imread(str(backup_path), cv2.IMREAD_COLOR)
    if room is None:
        print("[!] Error loading base panorama.")
        return
        
    rh, rw = room.shape[:2]
    print(f"[*] Base room loaded: {rw}x{rh}")

    # =========================================================================
    # 1. Clean & Polish Boutique Display Alcoves (keeping wall lighting & ceiling)
    # =========================================================================
    # Center Wall Wardrobe Alcove: X: [1260, 2340], Y: [170, 535]
    # We create an ultra-luxurious dark walnut wardrobe backboard with subtle warm lighting
    c_x1, c_x2 = 1260, 2340
    c_y1, c_y2 = 168, 535
    
    # Sample ambient room wall color tone
    ambient_wall = np.array([45, 65, 88], dtype=np.float32)  # Warm charcoal/walnut
    
    # Create smooth gradient alcove backdrop
    alcove = np.zeros((c_y2 - c_y1, c_x2 - c_x1, 3), dtype=np.uint8)
    for row in range(alcove.shape[0]):
        # Soft vertical gradient from ceiling light to floor shadow
        factor = 1.15 - 0.35 * (row / alcove.shape[0])
        col = np.clip(ambient_wall * factor, 0, 255).astype(np.uint8)
        alcove[row, :] = col
        
    # Subtle vertical panel grooves every 135 pixels
    for px in range(70, alcove.shape[1], 135):
        cv2.line(alcove, (px, 0), (px, alcove.shape[0]), (30, 45, 62), 2, cv2.LINE_AA)
        cv2.line(alcove, (px + 1, 0), (px + 1, alcove.shape[0]), (60, 85, 115), 1, cv2.LINE_AA)

    # Soft alpha blend alcove onto room with feathered edges
    feather = 25
    mask = np.ones((alcove.shape[0], alcove.shape[1]), dtype=np.float32)
    mask[:feather, :] *= np.linspace(0, 1, feather)[:, np.newaxis]
    mask[-feather:, :] *= np.linspace(1, 0, feather)[:, np.newaxis]
    mask[:, :feather] *= np.linspace(0, 1, feather)[np.newaxis, :]
    mask[:, -feather:] *= np.linspace(1, 0, feather)[np.newaxis, :]
    
    mask_3 = np.repeat(mask[:, :, np.newaxis], 3, axis=2)
    room[c_y1:c_y2, c_x1:c_x2] = (alcove * mask_3 + room[c_y1:c_y2, c_x1:c_x2] * (1.0 - mask_3)).astype(np.uint8)

    # Metallic Gold/Brass Wardrobe Hanging Rail across Center Wall
    rail_y = 188
    # Rail shadow
    cv2.line(room, (c_x1 + 10, rail_y + 4), (c_x2 - 10, rail_y + 4), (18, 25, 35), 6, cv2.LINE_AA)
    # Rail core (gold metallic finish)
    cv2.line(room, (c_x1 + 10, rail_y), (c_x2 - 10, rail_y), (40, 120, 180), 5, cv2.LINE_AA)
    cv2.line(room, (c_x1 + 10, rail_y - 1), (c_x2 - 10, rail_y - 1), (120, 200, 240), 2, cv2.LINE_AA)
    cv2.line(room, (c_x1 + 10, rail_y - 2), (c_x2 - 10, rail_y - 2), (200, 240, 255), 1, cv2.LINE_AA)

    # Rail mounting brackets
    for bx in [c_x1 + 20, (c_x1 + c_x2) // 2, c_x2 - 20]:
        cv2.rectangle(room, (bx - 6, rail_y - 12), (bx + 6, rail_y + 8), (30, 80, 130), -1)
        cv2.rectangle(room, (bx - 4, rail_y - 10), (bx + 4, rail_y + 6), (90, 160, 210), 1)

    # -------------------------------------------------------------------------
    # Right Wall Shelves: Eyewear & Caps Alcove
    # -------------------------------------------------------------------------
    r_x1, r_x2 = 2500, 3500
    r_y1, r_y2 = 175, 520
    
    r_ambient = np.array([40, 58, 78], dtype=np.float32)
    r_alcove = np.zeros((r_y2 - r_y1, r_x2 - r_x1, 3), dtype=np.uint8)
    for row in range(r_alcove.shape[0]):
        factor = 1.12 - 0.28 * (row / r_alcove.shape[0])
        r_alcove[row, :] = np.clip(r_ambient * factor, 0, 255).astype(np.uint8)
        
    r_mask = np.ones((r_alcove.shape[0], r_alcove.shape[1]), dtype=np.float32)
    r_mask[:feather, :] *= np.linspace(0, 1, feather)[:, np.newaxis]
    r_mask[-feather:, :] *= np.linspace(1, 0, feather)[:, np.newaxis]
    r_mask[:, :feather] *= np.linspace(0, 1, feather)[np.newaxis, :]
    r_mask[:, -feather:] *= np.linspace(1, 0, feather)[np.newaxis, :]
    r_mask_3 = np.repeat(r_mask[:, :, np.newaxis], 3, axis=2)
    room[r_y1:r_y2, r_x1:r_x2] = (r_alcove * r_mask_3 + room[r_y1:r_y2, r_x1:r_x2] * (1.0 - r_mask_3)).astype(np.uint8)

    # Floating Glass Shelves on Right Wall:
    # Top Shelf (Caps): Y = 320
    # Lower Shelf (Glasses): Y = 475
    for sy in [320, 475]:
        # Shelf underglow shadow
        cv2.line(room, (r_x1 + 15, sy + 6), (r_x2 - 15, sy + 6), (20, 28, 38), 5, cv2.LINE_AA)
        # Frosted glass shelf slab
        cv2.line(room, (r_x1 + 15, sy), (r_x2 - 15, sy), (80, 110, 140), 6, cv2.LINE_AA)
        # Crystal highlight edge
        cv2.line(room, (r_x1 + 15, sy - 2), (r_x2 - 15, sy - 2), (180, 220, 240), 2, cv2.LINE_AA)
        cv2.line(room, (r_x1 + 15, sy - 3), (r_x2 - 15, sy - 3), (255, 255, 255), 1, cv2.LINE_AA)
        # Modern steel wall bracket pins
        for pin_x in [r_x1 + 40, (r_x1 + r_x2)//2, r_x2 - 40]:
            cv2.rectangle(room, (pin_x - 5, sy - 4), (pin_x + 5, sy + 8), (140, 160, 180), -1)

    # -------------------------------------------------------------------------
    # Left Wall Shelves: Hair, Shawls & Mask
    # -------------------------------------------------------------------------
    l_x1, l_x2 = 180, 1020
    l_y1, l_y2 = 175, 520
    l_ambient = np.array([45, 68, 92], dtype=np.float32)
    l_alcove = np.zeros((l_y2 - l_y1, l_x2 - l_x1, 3), dtype=np.uint8)
    for row in range(l_alcove.shape[0]):
        factor = 1.15 - 0.30 * (row / l_alcove.shape[0])
        l_alcove[row, :] = np.clip(l_ambient * factor, 0, 255).astype(np.uint8)
        
    l_mask = np.ones((l_alcove.shape[0], l_alcove.shape[1]), dtype=np.float32)
    l_mask[:feather, :] *= np.linspace(0, 1, feather)[:, np.newaxis]
    l_mask[-feather:, :] *= np.linspace(1, 0, feather)[:, np.newaxis]
    l_mask[:, :feather] *= np.linspace(0, 1, feather)[np.newaxis, :]
    l_mask[:, -feather:] *= np.linspace(1, 0, feather)[np.newaxis, :]
    l_mask_3 = np.repeat(l_mask[:, :, np.newaxis], 3, axis=2)
    room[l_y1:l_y2, l_x1:l_x2] = (l_alcove * l_mask_3 + room[l_y1:l_y2, l_x1:l_x2] * (1.0 - l_mask_3)).astype(np.uint8)

    # Top Shelf for Hair (Y = 320)
    cv2.line(room, (l_x1 + 15, 326), (l_x2 - 15, 326), (20, 30, 42), 5, cv2.LINE_AA)
    cv2.line(room, (l_x1 + 15, 320), (l_x2 - 15, 320), (90, 120, 150), 6, cv2.LINE_AA)
    cv2.line(room, (l_x1 + 15, 318), (l_x2 - 15, 318), (200, 230, 250), 2, cv2.LINE_AA)
    cv2.line(room, (l_x1 + 15, 317), (l_x2 - 15, 317), (255, 255, 255), 1, cv2.LINE_AA)

    # Brass Shawl Display Bar on Left Wall (Y = 375)
    cv2.line(room, (l_x1 + 25, 380), (l_x2 - 25, 380), (18, 26, 38), 5, cv2.LINE_AA)
    cv2.line(room, (l_x1 + 25, 375), (l_x2 - 25, 375), (50, 140, 190), 5, cv2.LINE_AA)
    cv2.line(room, (l_x1 + 25, 374), (l_x2 - 25, 374), (140, 210, 245), 2, cv2.LINE_AA)

    # =========================================================================
    # 2. Place Real Wearable Items & Record Pixel-Perfect Hotspots
    # =========================================================================
    new_hotspots = []

    # -------------------------------------------------------------------------
    # A. CENTER WALL: Luxury Wardrobe (Suits, Gown, Wedding Dresses)
    # -------------------------------------------------------------------------
    center_items = [
        {"cat": "suite", "id": "suite_1", "title": "بدلة كحلية رسمية #1", "icon": "👔", "color": (255, 200, 0)},
        {"cat": "suite", "id": "suite_2", "title": "بدلة أعمال سوداء #2", "icon": "👔", "color": (255, 200, 0)},
        {"cat": "suite", "id": "suite_3", "title": "بدلة تاكسيدو رسمية #3", "icon": "👔", "color": (255, 200, 0)},
        {"cat": "graduition", "id": "graduition_1", "title": "روب التخرج الأكاديمي", "icon": "🎓", "color": (255, 200, 0)},
        {"cat": "suite", "id": "suite_4", "title": "بدلة عصرية رمادية #4", "icon": "👔", "color": (255, 200, 0)},
        {"cat": "suite", "id": "suite_5", "title": "بدلة كلاسيكية فاخرة #5", "icon": "👔", "color": (255, 200, 0)},
        {"cat": "maried", "id": "maried_1", "title": "فستان زفاف ملكي #1", "icon": "👰", "color": (255, 200, 0)},
        {"cat": "maried", "id": "maried_2", "title": "فستان سهرة راقي #2", "icon": "👰", "color": (255, 200, 0)},
    ]

    # Centers across center wardrobe:
    c_centers = np.linspace(1335, 2265, len(center_items), dtype=int)
    
    for idx, it_meta in enumerate(center_items):
        cx = c_centers[idx]
        img_path = THINGS_DIR / it_meta["cat"] / f"{it_meta['id']}.png"
        raw_img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
        if raw_img is None:
            continue
            
        clean_img, _ = get_clean_object(raw_img)
        
        # Scale to wardrobe height
        # Dresses & suits ~ 310 px tall
        target_h = 310
        aspect = clean_img.shape[1] / float(clean_img.shape[0])
        target_w = int(target_h * aspect)
        # Cap max width to prevent overlap
        if target_w > 120:
            target_w = 120
            target_h = int(target_w / aspect)
            
        scaled = cv2.resize(clean_img, (target_w, target_h), interpolation=cv2.INTER_AREA)
        
        # Position hanging from rail
        garment_top = rail_y + 22
        garment_x = cx - target_w // 2
        garment_y = garment_top
        
        # 1. Draw polished wooden coat hanger hook connecting rail to collar
        hook_x = cx
        cv2.line(room, (hook_x, rail_y), (hook_x, garment_top + 4), (180, 150, 100), 2, cv2.LINE_AA)
        cv2.line(room, (hook_x - 18, garment_top + 10), (hook_x, garment_top + 4), (180, 150, 100), 3, cv2.LINE_AA)
        cv2.line(room, (hook_x + 18, garment_top + 10), (hook_x, garment_top + 4), (180, 150, 100), 3, cv2.LINE_AA)
        
        # 2. Draw soft drop shadow behind garment
        draw_drop_shadow(room, scaled, garment_x, garment_y, offset=(6, 10), blur_kernel=21, opacity=0.45)
        
        # 3. Composite real garment
        alpha_blend(room, scaled, garment_x, garment_y)
        
        # Record hotspot bounding box
        rect = (garment_x - 8, garment_y - 12, garment_x + target_w + 8, garment_y + target_h + 10)
        new_hotspots.append({
            "id": it_meta["id"],
            "cat": it_meta["cat"],
            "title": it_meta["title"],
            "icon": it_meta["icon"],
            "wall": "center",
            "rect": rect,
            "color": it_meta["color"]
        })

    # -------------------------------------------------------------------------
    # B. RIGHT WALL: Top Shelf (Caps) & Lower Shelf (Eyewear)
    # -------------------------------------------------------------------------
    cap_items = [
        {"cat": "cap", "id": "cap_1", "title": "قبعة أنيقة #1", "icon": "🧢", "color": (255, 0, 127)},
        {"cat": "cap", "id": "cap_2", "title": "قبعة كلاسيكية #2", "icon": "🧢", "color": (255, 0, 127)},
        {"cat": "cap", "id": "cap_3", "title": "كاب رياضي #3", "icon": "🧢", "color": (255, 0, 127)},
        {"cat": "cap", "id": "cap_4", "title": "قبعة شتوية #4", "icon": "🧢", "color": (255, 0, 127)},
        {"cat": "cap", "id": "cap_5", "title": "قبعة سوداء فاخرة #5", "icon": "🧢", "color": (255, 0, 127)},
    ]
    r_shelf_centers = np.linspace(2580, 3420, len(cap_items), dtype=int)
    
    # 1. Caps on Top Shelf (Shelf line at Y = 320)
    for idx, it_meta in enumerate(cap_items):
        cx = r_shelf_centers[idx]
        img_path = THINGS_DIR / it_meta["cat"] / f"{it_meta['id']}.png"
        raw_img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
        if raw_img is None:
            continue
            
        clean_img, _ = get_clean_object(raw_img)
        target_h = 95
        aspect = clean_img.shape[1] / float(clean_img.shape[0])
        target_w = int(target_h * aspect)
        if target_w > 125:
            target_w = 125
            target_h = int(target_w / aspect)
            
        scaled = cv2.resize(clean_img, (target_w, target_h), interpolation=cv2.INTER_AREA)
        
        # Sit cap on shelf (shelf at y = 320)
        cap_x = cx - target_w // 2
        cap_y = 318 - target_h
        
        # Pedestal / display block under cap
        cv2.rectangle(room, (cx - 28, 314), (cx + 28, 320), (70, 95, 120), -1)
        
        draw_drop_shadow(room, scaled, cap_x, cap_y, offset=(4, 6), blur_kernel=15, opacity=0.40)
        alpha_blend(room, scaled, cap_x, cap_y)
        
        rect = (cap_x - 8, cap_y - 8, cap_x + target_w + 8, cap_y + target_h + 10)
        new_hotspots.append({
            "id": it_meta["id"],
            "cat": it_meta["cat"],
            "title": it_meta["title"],
            "icon": it_meta["icon"],
            "wall": "right",
            "rect": rect,
            "color": it_meta["color"]
        })

    # 2. Glasses on Lower Shelf (Shelf line at Y = 475)
    glasses_items = [
        {"cat": "glasses", "id": "glasses_1", "title": "نظارة شمسية فاخرة #1", "icon": "👓", "color": (0, 229, 255)},
        {"cat": "glasses", "id": "glasses_2", "title": "نظارة شمسية كلاسيك #2", "icon": "👓", "color": (0, 229, 255)},
        {"cat": "glasses", "id": "glasses_3", "title": "نظارة أفياتور ذهبية #3", "icon": "👓", "color": (0, 229, 255)},
        {"cat": "glasses", "id": "glasses_4", "title": "نظارة سوداء داكنة #4", "icon": "👓", "color": (0, 229, 255)},
        {"cat": "glasses", "id": "glasses_5", "title": "نظارة عصرية راقية #5", "icon": "👓", "color": (0, 229, 255)},
    ]
    for idx, it_meta in enumerate(glasses_items):
        cx = r_shelf_centers[idx]
        img_path = THINGS_DIR / it_meta["cat"] / f"{it_meta['id']}.png"
        raw_img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
        if raw_img is None:
            continue
            
        clean_img, _ = get_clean_object(raw_img)
        target_w = 120
        aspect = clean_img.shape[0] / float(clean_img.shape[1])
        target_h = int(target_w * aspect)
        if target_h > 65:
            target_h = 65
            target_w = int(target_h / aspect)
            
        scaled = cv2.resize(clean_img, (target_w, target_h), interpolation=cv2.INTER_AREA)
        
        # Rest glasses on crystal stand (shelf at 475)
        g_x = cx - target_w // 2
        g_y = 470 - target_h
        
        # Transparent crystal stand block
        cv2.rectangle(room, (cx - 24, 465), (cx + 24, 475), (100, 130, 160), -1)
        cv2.rectangle(room, (cx - 22, 466), (cx + 22, 474), (180, 220, 255), 1)
        
        draw_drop_shadow(room, scaled, g_x, g_y, offset=(3, 5), blur_kernel=11, opacity=0.35)
        alpha_blend(room, scaled, g_x, g_y)
        
        rect = (g_x - 10, g_y - 8, g_x + target_w + 10, g_y + target_h + 12)
        new_hotspots.append({
            "id": it_meta["id"],
            "cat": it_meta["cat"],
            "title": it_meta["title"],
            "icon": it_meta["icon"],
            "wall": "right",
            "rect": rect,
            "color": it_meta["color"]
        })

    # -------------------------------------------------------------------------
    # C. LEFT WALL: Hairstyles (Top Shelf) & Traditional Shawls / Mask (Lower)
    # -------------------------------------------------------------------------
    hair_items = [
        {"cat": "hair", "id": "hair_1", "title": "تسريحة شعر أنيقة #1", "icon": "💇", "color": (0, 229, 255)},
        {"cat": "hair", "id": "hair_2", "title": "تسريحة شعر كلاسيك #2", "icon": "💇", "color": (0, 229, 255)},
        {"cat": "hair", "id": "hair_3", "title": "تسريحة شعر عصرية #3", "icon": "💇", "color": (0, 229, 255)},
        {"cat": "hair", "id": "hair_4", "title": "تسريحة شعر مميزة #4", "icon": "💇", "color": (0, 229, 255)},
    ]
    l_hair_centers = np.linspace(260, 940, len(hair_items), dtype=int)
    
    # 1. Hair models on Top Shelf (Shelf line at 320)
    for idx, it_meta in enumerate(hair_items):
        cx = l_hair_centers[idx]
        img_path = THINGS_DIR / it_meta["cat"] / f"{it_meta['id']}.png"
        raw_img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
        if raw_img is None:
            continue
            
        clean_img, _ = get_clean_object(raw_img)
        target_h = 105
        aspect = clean_img.shape[1] / float(clean_img.shape[0])
        target_w = int(target_h * aspect)
        if target_w > 120:
            target_w = 120
            target_h = int(target_w / aspect)
            
        scaled = cv2.resize(clean_img, (target_w, target_h), interpolation=cv2.INTER_AREA)
        
        h_x = cx - target_w // 2
        h_y = 318 - target_h
        
        # Salon mannequin pedestal base
        cv2.rectangle(room, (cx - 20, 314), (cx + 20, 320), (80, 105, 130), -1)
        
        draw_drop_shadow(room, scaled, h_x, h_y, offset=(4, 6), blur_kernel=15, opacity=0.38)
        alpha_blend(room, scaled, h_x, h_y)
        
        rect = (h_x - 8, h_y - 8, h_x + target_w + 8, h_y + target_h + 10)
        new_hotspots.append({
            "id": it_meta["id"],
            "cat": it_meta["cat"],
            "title": it_meta["title"],
            "icon": it_meta["icon"],
            "wall": "left",
            "rect": rect,
            "color": it_meta["color"]
        })

    # 2. Shawls (Wishah) and Shemagh/Mask (Lower Rail at 375)
    heritage_items = [
        {"cat": "wishah", "id": "wishah_1", "title": "وشاح حريري فاخر #1", "icon": "🧣", "color": (0, 229, 255)},
        {"cat": "wishah", "id": "wishah_2", "title": "شال كشميري ملكي #2", "icon": "🧣", "color": (0, 229, 255)},
        {"cat": "mask", "id": "mask_1", "title": "شماغ وقناع كوفية أصيل", "icon": "😷", "color": (0, 229, 255)},
    ]
    l_heritage_centers = np.linspace(350, 850, len(heritage_items), dtype=int)
    
    for idx, it_meta in enumerate(heritage_items):
        cx = l_heritage_centers[idx]
        img_path = THINGS_DIR / it_meta["cat"] / f"{it_meta['id']}.png"
        raw_img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
        if raw_img is None:
            continue
            
        clean_img, _ = get_clean_object(raw_img)
        target_h = 135
        aspect = clean_img.shape[1] / float(clean_img.shape[0])
        target_w = int(target_h * aspect)
        if target_w > 135:
            target_w = 135
            target_h = int(target_w / aspect)
            
        scaled = cv2.resize(clean_img, (target_w, target_h), interpolation=cv2.INTER_AREA)
        
        w_x = cx - target_w // 2
        w_y = 385  # Draped below rail
        
        draw_drop_shadow(room, scaled, w_x, w_y, offset=(5, 8), blur_kernel=17, opacity=0.40)
        alpha_blend(room, scaled, w_x, w_y)
        
        rect = (w_x - 10, w_y - 8, w_x + target_w + 10, w_y + target_h + 10)
        new_hotspots.append({
            "id": it_meta["id"],
            "cat": it_meta["cat"],
            "title": it_meta["title"],
            "icon": it_meta["icon"],
            "wall": "left",
            "rect": rect,
            "color": it_meta["color"]
        })

    # =========================================================================
    # 3. Save Final Composite & Export Hotspot Data
    # =========================================================================
    output_path = BG_DIR / "panorama_room_3840.jpg"
    cv2.imwrite(str(output_path), room, [cv2.IMWRITE_JPEG_QUALITY, 96])
    print(f"[+] Successfully generated and saved: {output_path} ({room.shape})")

    # Ensure all rect values are native Python ints
    clean_hotspots = []
    for hs in new_hotspots:
        hs_copy = dict(hs)
        hs_copy["rect"] = [int(v) for v in hs["rect"]]
        clean_hotspots.append(hs_copy)

    # Export hotspots json
    json_path = BG_DIR / "spatial_hotspots.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(clean_hotspots, f, ensure_ascii=False, indent=2)
    print(f"[+] Saved {len(clean_hotspots)} pixel-perfect spatial hotspots to: {json_path}")

    return clean_hotspots

if __name__ == "__main__":
    build_boutique_panorama()
