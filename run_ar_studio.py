#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
================================================================================
VisionCraft - Standalone AR Smart Mirror & Try-On Studio (Python Native)
================================================================================
غرفة المراية الافتراضية الذكية وتجربة الملابس التفاعلية بالبايثون
* نفس التصميم الأصلي الأنيق مع أرفف مكانية جانبية وقوائم منسدلة
* خط عربي أصيل ورسم زجاجي فائق الجودة (Glassmorphism & Neon Glow)
* أزرار وقوائم تفاعلية بالنقر بالفأرة (Mouse Click & Hover)
* تتبع الوجه والجسم واليدين في الوقت الحقيقي (Realtime 60 FPS)
* تجربة وتركيب البدلات والأزياء والنظارات والقبعات بدقة تشريحية
* دعم الكاميرا المزدوجة (Laptop Cam + IP Cam)
================================================================================
"""

import sys
import os
import time
import math
import json
import argparse
import threading
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Audio playback support via sounddevice & scipy
try:
    import sounddevice as sd
    from scipy.io import wavfile
    HAS_AUDIO = True
except ImportError:
    HAS_AUDIO = False

# Arabic text shaping
try:
    import arabic_reshaper
    from bidi.algorithm import get_display
    HAS_BIDI = True
except ImportError:
    HAS_BIDI = False

# Suppress verbose C++ logs and offline telemetry errors
os.environ["GLOG_minloglevel"] = "2"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
os.environ["ABSL_LOG_MIN_SEVERITY"] = "2"

# Ensure UTF-8 output on Windows consoles
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Paths
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
SNAPSHOTS_DIR = BASE_DIR / "snapshots"
SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
CATALOG_PATH = BASE_DIR / "things_assets" / "catalog.json"
THINGS_DIR = BASE_DIR / "things_assets"
SOUNDS_DIR = THINGS_DIR / "sounds"
MODELS_DIR = BASE_DIR / "models"

# Fonts
FONT_PATH_REG = r"C:\Windows\Fonts\segoeui.ttf" if os.path.exists(r"C:\Windows\Fonts\segoeui.ttf") else "arial.ttf"
FONT_PATH_BOLD = r"C:\Windows\Fonts\segoeuib.ttf" if os.path.exists(r"C:\Windows\Fonts\segoeuib.ttf") else FONT_PATH_REG

try:
    FONT_TITLE = ImageFont.truetype(FONT_PATH_BOLD, 17)
    FONT_SHELF_TITLE = ImageFont.truetype(FONT_PATH_BOLD, 14)
    FONT_SHELF_SUB = ImageFont.truetype(FONT_PATH_REG, 11)
    FONT_BTN = ImageFont.truetype(FONT_PATH_BOLD, 13)
    FONT_ITEM = ImageFont.truetype(FONT_PATH_BOLD, 12)
    FONT_HUD = ImageFont.truetype(FONT_PATH_REG, 12)
except Exception:
    FONT_TITLE = FONT_SHELF_TITLE = FONT_SHELF_SUB = FONT_BTN = FONT_ITEM = FONT_HUD = ImageFont.load_default()

# MediaPipe modern Tasks Vision API
HAS_MEDIAPIPE = False
try:
    import mediapipe as mp
    from mediapipe.tasks.python import vision
    from mediapipe.tasks import python as mp_python
    HAS_MEDIAPIPE = True
except ImportError:
    pass


def get_lmk(lmk_container, idx):
    if lmk_container is None:
        return None
    try:
        if hasattr(lmk_container, "landmark"):
            return lmk_container.landmark[idx]
        return lmk_container[idx]
    except (IndexError, KeyError):
        return None


def format_ar_text(text):
    if not HAS_BIDI or not text:
        return text
    try:
        reshaped = arabic_reshaper.reshape(text)
        return get_display(reshaped)
    except Exception:
        return text


# MediaPipe Hand Skeletal Connections (21 Landmarks)
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),        # Thumb
    (0, 5), (5, 6), (6, 7), (7, 8),        # Index
    (5, 9), (9, 10), (10, 11), (11, 12),   # Middle
    (9, 13), (13, 14), (14, 15), (15, 16), # Ring
    (13, 17), (17, 18), (18, 19), (19, 20),# Pinky
    (0, 17)                                # Palm base
]


class ARAudioManager:
    """
    Real-Time Non-blocking AR Audio Engine using sounddevice & scipy.
    Supports dynamic looping, single-tap volume steps (+/- 10%),
    and instant thread-safe stop().
    """
    def __init__(self, sounds_dir):
        self.sounds_dir = Path(sounds_dir)
        self.tracks = []
        self.current_track_idx = 0
        self.volume = 0.70  # Default 70%
        self.is_playing = False
        self.stream = None
        self.audio_data = None
        self.play_pos = 0
        self.sr = 44100
        self.lock = threading.Lock()
        self.active_track_name = ""
        self.active_track_icon = "🎵"
        self._load_tracks()

    def _load_tracks(self):
        self.tracks = []
        if not self.sounds_dir.exists():
            return
        wav_files = sorted(list(self.sounds_dir.glob("*.wav")))
        meta = {
            "luxury_lounge.wav": {"title": "بوتيك فاخر (Luxury Lounge)", "icon": "🎻"},
            "oriental_oud.wav": {"title": "عود شرقي أصيل (Oriental Oud)", "icon": "🪕"},
            "wedding_melody.wav": {"title": "نغمات الزفاف (Wedding Melody)", "icon": "🎹"},
            "fashion_beats.wav": {"title": "إيقاع عرض الأزياء (Runway Beats)", "icon": "🎧"}
        }
        for f in wav_files:
            m = meta.get(f.name, {"title": f.stem.replace("_", " ").title(), "icon": "🎵"})
            self.tracks.append({
                "path": f,
                "name": f.name,
                "title": m["title"],
                "icon": m["icon"]
            })

    def _audio_callback(self, outdata, frames, time_info, status):
        with self.lock:
            if not self.is_playing or self.audio_data is None or len(self.audio_data) == 0:
                outdata.fill(0)
                return

            chunk_len = len(self.audio_data)
            end_pos = self.play_pos + frames

            if end_pos < chunk_len:
                chunk = self.audio_data[self.play_pos:end_pos]
                self.play_pos = end_pos
            else:
                part1 = self.audio_data[self.play_pos:]
                needed = frames - len(part1)
                wrapped_end = needed % chunk_len
                part2 = self.audio_data[:wrapped_end]
                reps = needed // chunk_len
                if reps > 0:
                    mid = np.tile(self.audio_data, reps)
                    chunk = np.concatenate([part1, mid, part2])
                else:
                    chunk = np.concatenate([part1, part2])
                self.play_pos = wrapped_end

            scaled = chunk * self.volume
            if scaled.ndim == 1:
                scaled = scaled[:, np.newaxis]
            if outdata.shape[1] > scaled.shape[1]:
                scaled = np.repeat(scaled, outdata.shape[1], axis=1)
            outdata[:] = scaled

    def play_track(self, track_idx):
        if not HAS_AUDIO or not self.tracks or track_idx < 0 or track_idx >= len(self.tracks):
            return
        track = self.tracks[track_idx]
        self.current_track_idx = track_idx
        self.active_track_name = track["title"]
        self.active_track_icon = track["icon"]

        try:
            sr, data = wavfile.read(str(track["path"]))
            if data.dtype == np.int16:
                data = data.astype(np.float32) / 32768.0
            elif data.dtype == np.int32:
                data = data.astype(np.float32) / 2147483648.0
            elif data.dtype == np.uint8:
                data = (data.astype(np.float32) - 128.0) / 128.0

            with self.lock:
                self.audio_data = data
                self.sr = sr
                self.play_pos = 0
                self.is_playing = True

            if self.stream is not None:
                try:
                    self.stream.stop()
                    self.stream.close()
                except Exception:
                    pass

            channels = 1 if data.ndim == 1 else data.shape[1]
            self.stream = sd.OutputStream(
                samplerate=sr,
                channels=channels,
                callback=self._audio_callback,
                blocksize=1024
            )
            self.stream.start()
        except Exception as e:
            print(f"[!] Audio playback error: {e}")

    def stop(self):
        with self.lock:
            self.is_playing = False
            self.play_pos = 0
        if self.stream is not None:
            try:
                self.stream.stop()
            except Exception:
                pass

    def adjust_volume(self, delta):
        self.volume = float(np.clip(round(self.volume + delta, 2), 0.0, 1.0))
        return int(self.volume * 100)


class OneEuroFilter:
    """
    1€ Filter: Adaptive Low-Pass Filter for Noise Reduction with Minimized Latency.
    Reference: Casiez et al., ACM CHI 2012 (http://cristal.univ-lille.fr/~casiez/1euro/)
    Eliminates high-frequency jitter at low speeds while maintaining instant responsiveness during fast movements.
    """
    def __init__(self, t0=0.0, x0=0.0, dx0=0.0, min_cutoff=0.08, beta=0.15, d_cutoff=1.0):
        self.min_cutoff = float(min_cutoff)
        self.beta = float(beta)
        self.d_cutoff = float(d_cutoff)
        self.x_prev = float(x0)
        self.dx_prev = float(dx0)
        self.t_prev = float(t0) if t0 > 0 else None

    def _alpha(self, cutoff, dt):
        tau = 1.0 / (2.0 * math.pi * max(1e-4, cutoff))
        return 1.0 / (1.0 + tau / max(1e-4, dt))

    def filter(self, t, x):
        if self.t_prev is None:
            self.t_prev = float(t)
            self.x_prev = float(x)
            self.dx_prev = 0.0
            return float(x)

        dt = max(1e-4, float(t) - self.t_prev)
        self.t_prev = float(t)

        # Filter the derivative (velocity)
        dx = (float(x) - self.x_prev) / dt
        a_d = self._alpha(self.d_cutoff, dt)
        dx_hat = a_d * dx + (1.0 - a_d) * self.dx_prev
        self.dx_prev = dx_hat

        # Dynamic cutoff frequency: small cutoff when still, large cutoff when moving
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a = self._alpha(cutoff, dt)
        x_hat = a * float(x) + (1.0 - a) * self.x_prev
        self.x_prev = x_hat
        return x_hat

    def reset(self, t=0.0, x=0.0):
        self.t_prev = float(t) if t > 0 else None
        self.x_prev = float(x)
        self.dx_prev = 0.0


class ARStudioEngine:
    def __init__(self, ipcam_url="http://192.168.8.106:8080/video"):
        self.ipcam_url = ipcam_url
        self.camera_source = "local"
        self.cap = None
        self.window_name = "VisionCraft AR Smart Mirror & Try-On Studio (Python Native)"

        # Hardware Acceleration & GPU/CPU Detection
        self.has_gpu = False
        self.gpu_device_name = "CPU"
        self._init_hardware_acceleration()

        # Load catalog
        self.catalog = self._load_catalog()
        
        # 3-Wall Room Categories mapped to the 3 Virtual Walls:
        # 1. Left Wall (الجدار الأيسر): الأوشحة، تراكيب الشعر، الأقنعة والكمامات
        # 2. Center Wall (الجدار الأوسط): خزانة البدلات، فساتين المناسبات، أزياء التخرج
        # 3. Right Wall (الجدار الأيمن): رف النظارات، الكوافي والقبعات
        self.shelf_categories = [
            # الجدار الأيسر (Left Wall)
            {"id": "wishah", "title": "رف الأوشحة الملكية", "icon": "🧣", "wall": "left", "shelf": "left", "y": 95, "count": 10, "color": (0, 229, 255)},
            {"id": "hair", "title": "تراكيب وتسريحات الشعر", "icon": "💇", "wall": "left", "shelf": "left", "y": 165, "count": 4, "color": (0, 229, 255)},
            {"id": "mask", "title": "الأقنعة والكمامات", "icon": "😷", "wall": "left", "shelf": "left", "y": 235, "count": 3, "color": (0, 229, 255)},

            # الجدار الأوسط (Center Wall - Main Wardrobe)
            {"id": "suite", "title": "علاقة البدلات الفاخرة", "icon": "👔", "wall": "center", "shelf": "center", "y": 95, "count": 11, "color": (255, 200, 0)},
            {"id": "maried", "title": "أزياء وفساتين المناسبات", "icon": "👰", "wall": "center", "shelf": "center", "y": 165, "count": 10, "color": (255, 200, 0)},
            {"id": "graduition", "title": "أزياء وأرواب التخرج", "icon": "🎓", "wall": "center", "shelf": "center", "y": 235, "count": 2, "color": (255, 200, 0)},

            # الجدار الأيمن (Right Wall)
            {"id": "glasses", "title": "رف النظارات الفاخرة", "icon": "👓", "wall": "right", "shelf": "right", "y": 95, "count": 8, "color": (255, 0, 127)},
            {"id": "cap", "title": "الكوافي والقبعات الأنيقة", "icon": "🧢", "wall": "right", "shelf": "right", "y": 165, "count": 5, "color": (255, 0, 127)}
        ]

        self.open_drawer = "suite"  # Default open category drawer
        self.drawer_scroll_idx = 0
        self.clickable_regions = []  # List of {"rect": (x1, y1, x2, y2), "action": fn}

        # Cache of loaded images & thumbnails
        self.asset_cache = {}
        self.thumb_cache = {}

        # Worn items state
        self.worn_items = {
            "suite": None,
            "maried": None,
            "glasses": None,
            "cap": None,
            "hair": None,
            "wishah": None,
            "mask": None,
            "graduition": None
        }

        # Fine-tuning for suit
        self.suit_scale = 1.0
        self.suit_shift_y = 0

        # UI state
        self.show_landmarks = False
        self.show_hud = True
        self.is_fullscreen = False
        self.toast_message = "مرحباً بك في استوديو المراية الذكية ثلاثية الجدران! 🪞🏡✨"
        self.toast_timer = time.time() + 4.0
        self.flash_alpha = 0.0

        # Motion smoothing cache
        self.smooth_anchors = {}
        self.last_gesture_time = 0

        # Hand Gesture Tracking State
        self.enable_gestures = True
        self.hand_cursor = {
            "x": 640,
            "y": 360,
            "is_visible": False,
            "is_pointing": False,
            "is_pinching": False,
            "pinch_ratio": 1.0,
            "last_seen": 0
        }
        self.prev_pinching = False
        self.last_reach_time = 0
        self.last_pinch_time = 0
        self.just_pinched = False

        # Smart AR Audio & Gesture Control
        self.audio_manager = ARAudioManager(SOUNDS_DIR)
        self.show_audio_menu = False
        self.selected_sound_idx = 0
        self.last_palm_time = 0
        self.prev_palm_state = False
        self.last_vol_time = 0
        self.volume_hud_timer = 0.0
        self.last_mute_time = 0

        # 3-Wall Virtual Dressing Room & Continuous Head/Gaze Yaw Tracking
        self.smooth_yaw = 0.0          # Normalized continuous yaw [-1.0: Left Wall, 0.0: Center Wall, +1.0: Right Wall]
        self.raw_yaw = 0.0
        self.yaw_calibration_offset = 0.0
        self.target_yaw_override = None # For clicking a wall tab to smoothly steer view
        self.active_wall = "center"     # "left", "center", "right"
        self.bg_panorama = None

        # 1€ Filter (One-Euro Filter) for rock-solid stability and zero-lag head tracking
        self.yaw_filter = OneEuroFilter(t0=time.time(), x0=0.0, min_cutoff=0.07, beta=0.15, d_cutoff=1.0)
        self.smooth_crop_x = None

        # Hand Tracking Persistence Buffer (prevents flickering during fast motions)
        self.last_valid_hand_lmks = None
        self.hand_persistence_frames = 0
        self.max_hand_persistence = 4

        # Virtual Background & Real-Time Segmentation
        self.image_segmenter = None
        self.bg_mode = "wall"  # "wall" (3-Wall Panoramic Room), "blur" (studio bokeh), "none" (real camera)
        self.bg_modes_list = ["wall", "blur", "none"]
        self.bg_wall_raw = None
        self.bg_wall_cached = None
        self.prev_seg_mask = None
        self.seg_threshold = 0.60  # Strict probability cutoff to reject couches, chairs, walls
        self.seg_feather = 0.14    # Smooth transition roll-off for anti-aliased natural edges
        self._load_background_assets()

        # MediaPipe Tasks Landmarkers
        self.face_landmarker = None
        self.pose_landmarker = None
        self.hand_landmarker = None
        self._init_mediapipe_tasks()

        # Preload catalog assets & thumbnails
        self._preload_assets()

        # Interactive Spatial Image Map on Walls (خريطة النقاط المكانية التفاعلية على الجدران)
        self.current_pano_offset_x = 0
        self.current_pano_scale_x = 1.0
        self.current_pano_scale_y = 1.0
        self.spatial_hotspots = []
        self._init_spatial_hotspots()

    def _init_spatial_hotspots(self):
        # 1. Try loading pixel-perfect hotspots from spatial_hotspots.json
        hotspots_json = THINGS_DIR / "backgrounds" / "spatial_hotspots.json"
        loaded_from_json = False
        if hotspots_json.exists():
            try:
                with open(hotspots_json, "r", encoding="utf-8") as f:
                    self.spatial_hotspots = json.load(f)
                    loaded_from_json = True
            except Exception as e:
                print(f"[!] Error reading spatial_hotspots.json: {e}")

        if not loaded_from_json or not self.spatial_hotspots:
            # Verified coordinates matching things_assets/backgrounds/panorama_room_3840.jpg
            self.spatial_hotspots = [
                # Center Wall: Luxury Wardrobe
                {"id": "suite_1", "cat": "suite", "title": "بدلة كحلية رسمية #1", "icon": "👔", "wall": "center", "rect": [1267, 198, 1403, 402], "color": [255, 200, 0]},
                {"id": "suite_2", "cat": "suite", "title": "بدلة أعمال سوداء #2", "icon": "👔", "wall": "center", "rect": [1399, 198, 1535, 373], "color": [255, 200, 0]},
                {"id": "suite_3", "cat": "suite", "title": "بدلة تاكسيدو رسمية #3", "icon": "👔", "wall": "center", "rect": [1551, 198, 1650, 530], "color": [255, 200, 0]},
                {"id": "graduition_1", "cat": "graduition", "title": "روب التخرج الأكاديمي", "icon": "🎓", "wall": "center", "rect": [1665, 198, 1801, 356], "color": [255, 200, 0]},
                {"id": "suite_4", "cat": "suite", "title": "بدلة عصرية رمادية #4", "icon": "👔", "wall": "center", "rect": [1798, 198, 1934, 389], "color": [255, 200, 0]},
                {"id": "suite_5", "cat": "suite", "title": "بدلة كلاسيكية فاخرة #5", "icon": "👔", "wall": "center", "rect": [1931, 198, 2067, 396], "color": [255, 200, 0]},
                {"id": "maried_1", "cat": "maried", "title": "فستان زفاف ملكي #1", "icon": "👰", "wall": "center", "rect": [2063, 198, 2199, 437], "color": [255, 200, 0]},
                {"id": "maried_2", "cat": "maried", "title": "فستان سهرة راقي #2", "icon": "👰", "wall": "center", "rect": [2196, 198, 2332, 400], "color": [255, 200, 0]},
                # Right Wall: Top Shelf (Caps)
                {"id": "cap_1", "cat": "cap", "title": "قبعة أنيقة #1", "icon": "🧢", "wall": "right", "rect": [2533, 217, 2627, 328], "color": [255, 0, 127]},
                {"id": "cap_2", "cat": "cap", "title": "قبعة كلاسيكية #2", "icon": "🧢", "wall": "right", "rect": [2736, 221, 2844, 328], "color": [255, 0, 127]},
                {"id": "cap_3", "cat": "cap", "title": "كاب رياضي #3", "icon": "🧢", "wall": "right", "rect": [2917, 225, 3043, 328], "color": [255, 0, 127]},
                {"id": "cap_4", "cat": "cap", "title": "قبعة شتوية #4", "icon": "🧢", "wall": "right", "rect": [3139, 219, 3221, 328], "color": [255, 0, 127]},
                {"id": "cap_5", "cat": "cap", "title": "قبعة سوداء فاخرة #5", "icon": "🧢", "wall": "right", "rect": [3311, 256, 3489, 328], "color": [255, 0, 127]},
                # Right Wall: Lower Shelf (Eyewear)
                {"id": "glasses_1", "cat": "glasses", "title": "نظارة شمسية فاخرة #1", "icon": "👓", "wall": "right", "rect": [2510, 404, 2650, 482], "color": [0, 229, 255]},
                {"id": "glasses_2", "cat": "glasses", "title": "نظارة شمسية كلاسيك #2", "icon": "👓", "wall": "right", "rect": [2720, 416, 2860, 482], "color": [0, 229, 255]},
                {"id": "glasses_3", "cat": "glasses", "title": "نظارة أفياتور ذهبية #3", "icon": "👓", "wall": "right", "rect": [2910, 418, 3050, 482], "color": [0, 229, 255]},
                {"id": "glasses_4", "cat": "glasses", "title": "نظارة سوداء داكنة #4", "icon": "👓", "wall": "right", "rect": [3110, 417, 3250, 482], "color": [0, 229, 255]},
                {"id": "glasses_5", "cat": "glasses", "title": "نظارة عصرية راقية #5", "icon": "👓", "wall": "right", "rect": [3310, 415, 3450, 482], "color": [0, 229, 255]},
                # Left Wall: Top Shelf (Hair)
                {"id": "hair_1", "cat": "hair", "title": "تسريحة شعر أنيقة #1", "icon": "💇", "wall": "left", "rect": [216, 241, 304, 328], "color": [0, 229, 255]},
                {"id": "hair_2", "cat": "hair", "title": "تسريحة شعر كلاسيك #2", "icon": "💇", "wall": "left", "rect": [421, 250, 551, 328], "color": [0, 229, 255]},
                {"id": "hair_3", "cat": "hair", "title": "تسريحة شعر عصرية #3", "icon": "💇", "wall": "left", "rect": [634, 217, 766, 328], "color": [0, 229, 255]},
                {"id": "hair_4", "cat": "hair", "title": "تسريحة شعر مميزة #4", "icon": "💇", "wall": "left", "rect": [846, 230, 954, 328], "color": [0, 229, 255]},
                # Left Wall: Lower Rail (Shawls & Mask)
                {"id": "wishah_1", "cat": "wishah", "title": "وشاح حريري فاخر #1", "icon": "🧣", "wall": "left", "rect": [298, 377, 402, 530], "color": [0, 229, 255]},
                {"id": "wishah_2", "cat": "wishah", "title": "شال كشميري ملكي #2", "icon": "🧣", "wall": "left", "rect": [526, 377, 674, 530], "color": [0, 229, 255]},
                {"id": "mask_1", "cat": "mask", "title": "شماغ وقناع كوفية أصيل", "icon": "😷", "wall": "left", "rect": [798, 377, 902, 530], "color": [0, 229, 255]}
            ]

        # Link each hotspot to its full catalog item object
        for hs in self.spatial_hotspots:
            cat_id = hs["cat"]
            it_id = hs["id"]
            matched_item = None
            if cat_id in self.catalog:
                for item in self.catalog[cat_id].get("items", []):
                    if item.get("id") == it_id:
                        matched_item = item
                        break
            hs["item_obj"] = matched_item
        print(f"[+] تم تفعيل خريطة التفاعل المباشر مع عناصر الجدران (Spatial Hotspots: {len(self.spatial_hotspots)} قطعة)! 🖼️👌✨")

    def _load_background_assets(self):
        pano_path = THINGS_DIR / "backgrounds" / "panorama_room_3840.jpg"
        if pano_path.exists():
            try:
                with open(pano_path, "rb") as f:
                    nparr = np.frombuffer(f.read(), np.uint8)
                    self.bg_panorama = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    print(f"[+] تم تحميل بانوراما الغرفة الافتراضية ثلاثية الجدران ({self.bg_panorama.shape}) بنجاح! 🏡🪞✨")
            except Exception as e:
                print(f"[!] Panorama load error: {e}")

        wall_path = THINGS_DIR / "backgrounds" / "house_wall.jpg"
        if wall_path.exists():
            try:
                with open(wall_path, "rb") as f:
                    nparr = np.frombuffer(f.read(), np.uint8)
                    self.bg_wall_raw = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            except Exception as e:
                print(f"[!] Background load error: {e}")

    def _init_hardware_acceleration(self):
        try:
            if cv2.ocl.haveOpenCL():
                cv2.ocl.setUseOpenCL(True)
                dev = cv2.ocl.Device.getDefault()
                if dev.type() == cv2.ocl.Device_TYPE_GPU:
                    self.has_gpu = True
                    self.gpu_device_name = dev.name()
                    print(f"[+] تم تفعيل تسريع كرت الشاشة للرسوميات (GPU OpenCL): {self.gpu_device_name} 🚀")
                else:
                    print(f"[*] معالجة الرسوميات: OpenCL ({dev.name()})")
            else:
                print("[*] معالجة الرسوميات: معالج النظام (CPU Multi-threaded SIMD) 💻")
        except Exception as e:
            print(f"[*] Hardware acceleration check: {e}")

        # MediaPipe AI Engine Probe (Test GPU delegate availability safely)
        self.mediapipe_gpu_supported = False
        seg_test = MODELS_DIR / "selfie_segmenter.tflite"
        if seg_test.exists() and hasattr(mp_python.BaseOptions, "Delegate"):
            try:
                test_opts = mp_python.BaseOptions(
                    model_asset_path=str(seg_test),
                    delegate=mp_python.BaseOptions.Delegate.GPU
                )
                test_seg = vision.ImageSegmenter.create_from_options(
                    vision.ImageSegmenterOptions(base_options=test_opts, running_mode=vision.RunningMode.IMAGE)
                )
                test_seg.close()
                self.mediapipe_gpu_supported = True
                print("[+] تم تفعيل تسريع كرت الشاشة لنماذج الذكاء الاصطناعي (MediaPipe GPU) 🚀")
            except Exception:
                self.mediapipe_gpu_supported = False
                print("[+] محرك الذكاء الاصطناعي: معالج النظام فائق السرعة (CPU XNNPACK Vectorized) ⚡")

    def _create_base_options(self, model_path):
        if getattr(self, "mediapipe_gpu_supported", False):
            try:
                return mp_python.BaseOptions(
                    model_asset_path=str(model_path),
                    delegate=mp_python.BaseOptions.Delegate.GPU
                )
            except Exception:
                pass
        return mp_python.BaseOptions(model_asset_path=str(model_path))

    def _init_mediapipe_tasks(self):
        if not HAS_MEDIAPIPE:
            return

        face_task_path = MODELS_DIR / "face_landmarker.task"
        pose_task_path = MODELS_DIR / "pose_landmarker.task"
        hand_task_path = MODELS_DIR / "hand_landmarker.task"
        seg_task_path = MODELS_DIR / "selfie_segmenter.tflite"

        if face_task_path.exists():
            try:
                base_opts = self._create_base_options(face_task_path)
                opts = vision.FaceLandmarkerOptions(
                    base_options=base_opts,
                    running_mode=vision.RunningMode.IMAGE,
                    num_faces=1
                )
                self.face_landmarker = vision.FaceLandmarker.create_from_options(opts)
            except Exception as e:
                print(f"[!] FaceLandmarker init error: {e}")

        if pose_task_path.exists():
            try:
                base_opts = self._create_base_options(pose_task_path)
                opts = vision.PoseLandmarkerOptions(
                    base_options=base_opts,
                    running_mode=vision.RunningMode.IMAGE
                )
                self.pose_landmarker = vision.PoseLandmarker.create_from_options(opts)
            except Exception as e:
                print(f"[!] PoseLandmarker init error: {e}")

        if hand_task_path.exists():
            try:
                base_opts = self._create_base_options(hand_task_path)
                opts = vision.HandLandmarkerOptions(
                    base_options=base_opts,
                    running_mode=vision.RunningMode.IMAGE,
                    num_hands=2,
                    min_hand_detection_confidence=0.5,
                    min_hand_presence_confidence=0.5,
                    min_tracking_confidence=0.5
                )
                self.hand_landmarker = vision.HandLandmarker.create_from_options(opts)
                print("[+] تم تفعيل وتجهيز محرك إيماءات اليد والأصابع (Hand Landmarker) بنجاح!")
            except Exception as e:
                print(f"[!] HandLandmarker init error: {e}")

        if seg_task_path.exists():
            try:
                base_opts = self._create_base_options(seg_task_path)
                opts = vision.ImageSegmenterOptions(
                    base_options=base_opts,
                    running_mode=vision.RunningMode.IMAGE,
                    output_category_mask=False,
                    output_confidence_masks=True
                )
                self.image_segmenter = vision.ImageSegmenter.create_from_options(opts)
                print("[+] تم تفعيل وتجهيز عازل الخلفية الذكي (Selfie Segmenter) بنجاح! 🪄")
            except Exception as e:
                print(f"[!] ImageSegmenter init error: {e}")

    def _load_catalog(self):
        if CATALOG_PATH.exists():
            try:
                with open(CATALOG_PATH, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print(f"[!] Error reading catalog: {e}")
        return {}

    def _preload_assets(self):
        print("[*] جاري تجهيز أيقونات وملابس الاستوديو في الذاكرة...")
        count = 0
        for cat_key, cat_data in self.catalog.items():
            for item in cat_data.get("items", []):
                self._load_item_image(item)
                count += 1
        print(f"[+] تم تجهيز {count} قطعة ملابس وأكسسوار بنجاح!")

    def _load_item_image(self, item):
        item_id = item.get("id")
        if item_id in self.asset_cache:
            return self.asset_cache[item_id]

        rel_url = item.get("url", "")
        img_path = THINGS_DIR / rel_url.replace("things_assets/", "")
        if not img_path.exists():
            for p in THINGS_DIR.rglob(Path(rel_url).name):
                img_path = p
                break

        if img_path.exists():
            # Ensure keypoints from individual JSON file are always loaded
            json_candidate = img_path.with_suffix(".json")
            if json_candidate.exists() and ("keypoints" not in item or not item["keypoints"]):
                try:
                    with open(json_candidate, "r", encoding="utf-8") as jf:
                        jdata = json.load(jf)
                        if "keypoints" in jdata:
                            item["keypoints"] = jdata["keypoints"]
                except Exception:
                    pass

            try:
                with open(img_path, "rb") as f:
                    nparr = np.frombuffer(f.read(), np.uint8)
                    img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
                    if img is not None:
                        if img.shape[2] == 3:
                            img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
                        self.asset_cache[item_id] = img
                        # Generate 46x46 thumbnail
                        thumb = cv2.resize(img, (46, 46), interpolation=cv2.INTER_AREA)
                        self.thumb_cache[item_id] = thumb
                        return img
            except Exception:
                pass
        return None

    def start_camera(self, source="local"):
        if self.cap is not None:
            self.cap.release()

        self.camera_source = source
        if source == "local":
            print("[*] جاري فتح كاميرا اللابتوب...")
            self.cap = cv2.VideoCapture(0, cv2.CAP_DSHOW if sys.platform.startswith("win") else cv2.CAP_ANY)
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            self.cap.set(cv2.CAP_PROP_FPS, 60)
            self.toast("تم تفعيل كاميرا الكمبيوتر 💻✨")
        else:
            print(f"[*] جاري الاتصال بكاميرا الجوال ({self.ipcam_url})...")
            self.cap = cv2.VideoCapture(self.ipcam_url)
            self.toast("تم تفعيل كاميرا الجوال اللاسلكية 📱✨")

        if not self.cap.isOpened():
            print(f"[!] تعذر فتح المصدر '{source}'. التحويل إلى كاميرا الكمبيوتر 0...")
            self.cap = cv2.VideoCapture(0)
            self.camera_source = "local"

    def toggle_camera(self):
        new_source = "ipcam" if self.camera_source == "local" else "local"
        self.start_camera(new_source)

    def toggle_gestures(self):
        self.enable_gestures = not self.enable_gestures
        st = "تفعيل" if self.enable_gestures else "تعطيل"
        self.toast(f"تم {st} التحكم بإيماءات اليد والحركة 🖐️✨", 2.0)

    def toggle_background(self):
        cur_idx = self.bg_modes_list.index(self.bg_mode)
        self.bg_mode = self.bg_modes_list[(cur_idx + 1) % len(self.bg_modes_list)]
        if self.bg_mode == "wall":
            self.toast("الخلفية: الغرفة الافتراضية ثلاثية الجدران 🏡🪞✨", 2.5)
        elif self.bg_mode == "blur":
            self.toast("الخلفية: عزل سينمائي ضبابي (Studio Blur) 🌫️✨", 2.5)
        else:
            self.toast("الخلفية: الكاميرا الواقعية الأصلية 📷", 2.5)

    def look_at_wall(self, target_yaw):
        self.target_yaw_override = target_yaw
        if target_yaw < -0.2:
            self.toast("التوجه نحو: الجدار الأيسر (الأوشحة وتراكيب الشعر) 🧣💇", 2.0)
        elif target_yaw > 0.2:
            self.toast("التوجه نحو: الجدار الأيمن (رف النظارات والقبعات) 👓🧢", 2.0)
        else:
            self.toast("التوجه نحو: الجدار الأوسط (خزانة الملابس والبدلات) 👔👰", 2.0)

    def calibrate_center(self):
        self.yaw_calibration_offset = self.raw_yaw
        self.smooth_yaw = 0.0
        if hasattr(self, "yaw_filter"):
            self.yaw_filter.reset(time.time(), 0.0)
        self.smooth_crop_x = None
        self.toast("تمت معايرة وتثبيت زاوية النظر إلى المركز 🎯✨", 2.5)

    def compute_head_and_gaze_yaw(self, face_lmks, fw, fh):
        now = time.time()
        if not face_lmks:
            # Gradually ease towards center if face temporarily lost
            self.smooth_yaw = self.yaw_filter.filter(now, 0.0)
            return self.smooth_yaw

        nose = get_lmk(face_lmks, 1)
        right_cheek = get_lmk(face_lmks, 234)
        left_cheek = get_lmk(face_lmks, 454)

        if not (nose and right_cheek and left_cheek):
            return self.smooth_yaw

        nx = nose.x * fw
        rx = right_cheek.x * fw
        lx = left_cheek.x * fw

        # Ensure rx < lx
        if rx > lx:
            rx, lx = lx, rx

        d_left = abs(lx - nx)
        d_right = abs(nx - rx)

        # In flipped (mirror) view:
        # Looking right: nose moves to the right of the face (larger x), d_right increases, d_left decreases.
        # So (d_right - d_left) > 0 (positive yaw, right wall).
        # Looking left: nose moves left, (d_right - d_left) < 0 (negative yaw, left wall).
        raw_head_yaw = (d_right - d_left) / max(1.0, d_left + d_right) - self.yaw_calibration_offset
        self.raw_yaw = raw_head_yaw

        # 1. Comfortable deadband for rock-solid center wall focus (eliminates small head tremors)
        if abs(raw_head_yaw) < 0.045:
            target = 0.0
        else:
            # Smooth progressive response to head turns without aggressive jumps
            sign = 1.0 if raw_head_yaw > 0 else -1.0
            norm_val = (abs(raw_head_yaw) - 0.045) / (1.0 - 0.045)
            target = sign * float(np.clip(norm_val * 2.1, 0.0, 1.0))

        # 2. Smooth cinematic tracking via 1€ Filter (Eliminates high-frequency jitter, zero lag on turns)
        if self.target_yaw_override is not None:
            self.smooth_yaw = self.yaw_filter.filter(now, self.target_yaw_override)
            if abs(self.smooth_yaw - self.target_yaw_override) < 0.025:
                self.target_yaw_override = None
        else:
            self.smooth_yaw = self.yaw_filter.filter(now, target)

        # Determine active wall name with hysteresis to prevent edge flickering
        if self.smooth_yaw < -0.25:
            self.active_wall = "left"
        elif self.smooth_yaw > 0.25:
            self.active_wall = "right"
        elif abs(self.smooth_yaw) < 0.18:
            self.active_wall = "center"

        return self.smooth_yaw

    def apply_virtual_background(self, frame, mp_img, pose_lmks=None, hand_lmks_list=None):
        if self.bg_mode == "none" or self.image_segmenter is None:
            return

        fh, fw = frame.shape[:2]

        try:
            res_seg = self.image_segmenter.segment(mp_img)
            if not res_seg or not res_seg.confidence_masks:
                return

            raw_mask = res_seg.confidence_masks[0].numpy_view()
            if raw_mask.ndim == 3:
                raw_mask = raw_mask.squeeze(-1)

            if raw_mask.shape[:2] != (fh, fw):
                raw_mask = cv2.resize(raw_mask, (fw, fh), interpolation=cv2.INTER_LINEAR)

            # 1. High-Precision Probability Thresholding & Sigmoidal Roll-off
            # Eliminates background furniture (couch, chairs, bed, wall) with confidence < threshold
            t_min = max(0.05, self.seg_threshold - self.seg_feather)
            t_max = min(0.98, self.seg_threshold + self.seg_feather)
            norm_mask = np.clip((raw_mask - t_min) / max(0.01, t_max - t_min), 0.0, 1.0)
            # Smoothstep curve for razor-sharp yet antialiased natural edges
            crisp_mask = norm_mask * norm_mask * (3.0 - 2.0 * norm_mask)

            # 2. Anatomical Skeletal Envelope Gating (Cuts off sofa/couch wings extending beyond user)
            if pose_lmks:
                body_pts = []
                for idx in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 23, 24]:
                    lm = get_lmk(pose_lmks, idx)
                    if lm and getattr(lm, "visibility", 1.0) > 0.35:
                        body_pts.append((lm.x * fw, lm.y * fh))

                # Also expand envelope to include hands so outstretched arms/hands aren't clipped by the gate
                if hand_lmks_list:
                    for h in hand_lmks_list:
                        for lm in h:
                            body_pts.append((lm.x * fw, lm.y * fh))
                elif self.hand_persistence_frames > 0 and self.last_valid_hand_lmks:
                    for h in self.last_valid_hand_lmks:
                        for lm in h:
                            body_pts.append((lm.x * fw, lm.y * fh))

                if len(body_pts) >= 4:
                    bx_coords = [p[0] for p in body_pts]
                    by_coords = [p[1] for p in body_pts]
                    min_bx, max_bx = min(bx_coords), max(bx_coords)
                    min_by, max_by = min(by_coords), max(by_coords)
                    body_w = max(60.0, max_bx - min_bx)

                    # Generous anatomical envelope
                    env_x1 = max(0, int(min_bx - body_w * 0.40))
                    env_x2 = min(fw, int(max_bx + body_w * 0.40))
                    env_y1 = max(0, int(min_by - body_w * 0.40))
                    env_y2 = fh

                    # Create soft feathered spatial gate
                    gate = np.zeros((fh, fw), dtype=np.float32)
                    gate[env_y1:env_y2, env_x1:env_x2] = 1.0
                    gate = cv2.GaussianBlur(gate, (31, 31), 0)
                    crisp_mask = crisp_mask * gate

            # 3. Hand Foreground Shield (Ultra-Fast SIMD morphological dilation & Temporal Persistence Buffer)
            if hand_lmks_list:
                self.last_valid_hand_lmks = hand_lmks_list
                self.hand_persistence_frames = self.max_hand_persistence
                effective_hands = hand_lmks_list
            elif self.hand_persistence_frames > 0 and self.last_valid_hand_lmks:
                self.hand_persistence_frames -= 1
                effective_hands = self.last_valid_hand_lmks
            else:
                effective_hands = None

            if effective_hands:
                hand_mask_u8 = np.zeros((fh, fw), dtype=np.uint8)
                for hand in effective_hands:
                    h_pts = np.array([(int(lm.x * fw), int(lm.y * fh)) for lm in hand], dtype=np.int32)
                    for i, j in HAND_CONNECTIONS:
                        if i < len(h_pts) and j < len(h_pts):
                            cv2.line(hand_mask_u8, tuple(h_pts[i]), tuple(h_pts[j]), 255, 36, cv2.LINE_AA)
                    for pt in h_pts:
                        cv2.circle(hand_mask_u8, tuple(pt), 28, 255, -1)
                    if len(h_pts) >= 4:
                        hull = cv2.convexHull(h_pts)
                        cv2.fillConvexPoly(hand_mask_u8, hull, 255)

                # Lightning-fast morphological dilation (runs in < 0.4ms, zero lag)
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
                hand_mask_u8 = cv2.dilate(hand_mask_u8, kernel, iterations=1)
                hand_mask_u8 = cv2.blur(hand_mask_u8, (7, 7))
                hand_shield = hand_mask_u8.astype(np.float32) / 255.0
                crisp_mask = np.maximum(crisp_mask, hand_shield)

            # 4. Temporal Exponential Smoothing for Jitter-Free Studio Matting
            if self.prev_seg_mask is None or self.prev_seg_mask.shape != (fh, fw):
                self.prev_seg_mask = crisp_mask.copy()
            else:
                self.prev_seg_mask = 0.55 * self.prev_seg_mask + 0.45 * crisp_mask

            smooth_mask = cv2.GaussianBlur(self.prev_seg_mask, (5, 5), 0)
            mask_3c = np.repeat(smooth_mask[:, :, np.newaxis], 3, axis=2)

            if self.bg_mode == "wall" and self.bg_panorama is not None:
                # Continuous panoramic room background with smooth eye/head yaw panning
                ph, pw = self.bg_panorama.shape[:2]
                if ph != fh:
                    scale = fh / float(ph)
                    pano_w = int(pw * scale)
                    scaled_pano = cv2.resize(self.bg_panorama, (pano_w, fh), interpolation=cv2.INTER_LINEAR)
                else:
                    scaled_pano = self.bg_panorama
                    pano_w = pw

                max_shift = max(0, pano_w - fw)
                center_x = max_shift // 2

                # Continuous sub-pixel floating crop interpolation:
                target_crop_x = float(center_x + self.smooth_yaw * center_x)
                target_crop_x = max(0.0, min(float(max_shift), target_crop_x))
                if self.smooth_crop_x is None:
                    self.smooth_crop_x = target_crop_x
                else:
                    # Floating continuous interpolation for cinematic smoothness
                    self.smooth_crop_x = 0.82 * self.smooth_crop_x + 0.18 * target_crop_x

                crop_x = int(round(self.smooth_crop_x))
                crop_x = max(0, min(max_shift, crop_x))
                self.current_pano_offset_x = crop_x
                self.current_pano_scale_x = float(pano_w) / float(pw)
                self.current_pano_scale_y = float(fh) / float(ph)

                bg_target = scaled_pano[:, crop_x : crop_x + fw]
                if bg_target.shape[1] != fw or bg_target.shape[0] != fh:
                    bg_target = cv2.resize(bg_target, (fw, fh))

            elif self.bg_mode == "wall" and self.bg_wall_raw is not None:
                if self.bg_wall_cached is None or self.bg_wall_cached.shape[:2] != (fh, fw):
                    self.bg_wall_cached = cv2.resize(self.bg_wall_raw, (fw, fh), interpolation=cv2.INTER_LINEAR)
                bg_target = self.bg_wall_cached
            elif self.bg_mode == "blur":
                bg_target = cv2.GaussianBlur(frame, (51, 51), 0)
            else:
                return

            # Blend person foreground with virtual background
            fg_part = (frame * mask_3c).astype(np.float32)
            bg_part = (bg_target * (1.0 - mask_3c)).astype(np.float32)
            frame[:] = cv2.add(fg_part.astype(np.uint8), bg_part.astype(np.uint8))
        except Exception as e:
            print(f"[!] Segmentation error: {e}")

    def toast(self, msg, duration=3.0):
        self.toast_message = msg
        self.toast_timer = time.time() + duration

    def wear_item(self, cat_key, item):
        slot = cat_key
        item_title = item.get("title", "القطعة")

        # 1. Un-wear if already wearing this exact item
        if self.worn_items.get(slot) and self.worn_items[slot].get("id") == item.get("id"):
            self.worn_items[slot] = None
            self.toast(f"تم نزع: {item_title} ✕", 2.0)
            return

        # 2. WEDDING DRESS PROTOCOL (قواعد فستان العرس)
        is_wearing_wedding_dress = (self.worn_items.get("maried") is not None)

        if is_wearing_wedding_dress:
            # Cannot wear caps or hats with wedding dresses (glasses only)
            if slot in ["cap", "caps"]:
                self.toast("لا يمكن ارتداء الكوفية مع فستان العرس (يصلح نظارة فقط)!", 3.0)
                return
            # Cannot wear heavy scarves or masks with wedding dresses
            if slot in ["wishah", "mask"]:
                self.toast("مع فستان العرس يصلح نظارة فقط لضمان تناسق المظهر!", 3.0)
                return

        # 3. BODY OUTFITS MUTUAL EXCLUSION (طبقة أزياء الجسم: بدلة / فستان عرس / روب تخرج)
        if slot in ["suite", "maried", "graduition"]:
            if slot == "maried":
                # When wearing a wedding dress: remove any suit, graduation gown, caps, scarves, or masks
                for b_slot in ["suite", "graduition"]:
                    self.worn_items[b_slot] = None
                for conf_slot in ["cap", "wishah", "mask"]:
                    self.worn_items[conf_slot] = None

                self.worn_items["maried"] = item
                self.toast(f"تم ارتداء: {item_title} (يتوافق مع النظارات فقط) ✨", 3.0)
                return
            else:
                # When wearing a suit or graduation gown: automatically replace any previous body outfit
                for b_slot in ["suite", "maried", "graduition"]:
                    if b_slot != slot:
                        self.worn_items[b_slot] = None

                self.worn_items[slot] = item
                self.toast(f"تم ارتداء: {item_title} ✓✨", 2.5)
                return

        # 4. Standard Single-Item-Per-Slot (One cap at a time, one glasses at a time, etc.)
        # Selecting another item in the same category seamlessly replaces the previous one
        self.worn_items[slot] = item
        self.toast(f"تم ارتداء: {item_title} ✓✨", 2.5)

    def clear_all_worn(self):
        for k in self.worn_items:
            self.worn_items[k] = None
        self.toast("تم نزع كافة الملابس والأكسسوارات 🔄")

    def save_snapshot(self, frame):
        ts = time.strftime("%Y%m%d_%H%M%S")
        filename = SNAPSHOTS_DIR / f"VisionCraft_AR_{ts}.png"
        cv2.imwrite(str(filename), frame)
        self.flash_alpha = 1.0
        self.toast(f"تم حفظ الصورة: {filename.name} 💾🎉", 4.0)

    # =========================================================================
    # Mouse Click Handler
    # =========================================================================
    def on_mouse(self, event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            for reg in self.clickable_regions:
                rx1, ry1, rx2, ry2 = reg["rect"]
                if rx1 <= x <= rx2 and ry1 <= y <= ry2:
                    reg["action"]()
                    break

    # =========================================================================
    # Smoothing & Warping Math
    # =========================================================================
    def _smooth(self, cache_key, val, alpha=0.78):
        if cache_key not in self.smooth_anchors or self.smooth_anchors[cache_key] is None:
            self.smooth_anchors[cache_key] = val
            return val
        prev = self.smooth_anchors[cache_key]
        diff = abs(val - prev)
        if diff > 90:  # Fast reset if person moved significantly
            self.smooth_anchors[cache_key] = val
            return val
        # Adaptive smoothing: hold micro-jitters (< 3.0 px) rock-steady
        if diff < 3.0:
            adapt_alpha = 0.95
        elif diff < 14.0:
            adapt_alpha = 0.85
        else:
            adapt_alpha = 0.65
        smoothed = adapt_alpha * prev + (1.0 - adapt_alpha) * val
        self.smooth_anchors[cache_key] = smoothed
        return smoothed

    def render_anchored_asset(self, frame, asset_img, kp1, kp2, dst1, dst2, cat_name, scale_mult=1.0, shift_y=0):
        if asset_img is None or dst1 is None or dst2 is None:
            return

        nh, nw = asset_img.shape[:2]
        p1x, p1y = kp1[0] * nw, kp1[1] * nh
        p2x, p2y = kp2[0] * nw, kp2[1] * nh

        # 1. Sort source anchor points left-to-right on the image
        if p1x <= p2x:
            plx, ply, prx, pry = p1x, p1y, p2x, p2y
        else:
            plx, ply, prx, pry = p2x, p2y, p1x, p1y

        l_src = math.hypot(prx - plx, pry - ply)
        if l_src < 2:
            return

        ang_src = math.atan2(pry - ply, prx - plx)
        c_src_x, c_src_y = (plx + prx) / 2.0, (ply + pry) / 2.0

        # 2. Sort target landmark points left-to-right on the person
        if dst1[0] <= dst2[0]:
            qlx, qly, qrx, qry = dst1[0], dst1[1], dst2[0], dst2[1]
        else:
            qlx, qly, qrx, qry = dst2[0], dst2[1], dst1[0], dst1[1]

        # Motion smoothing
        qlx = self._smooth(f"{cat_name}_qlx", qlx)
        qly = self._smooth(f"{cat_name}_qly", qly)
        qrx = self._smooth(f"{cat_name}_qrx", qrx)
        qry = self._smooth(f"{cat_name}_qry", qry)

        l_dst = math.hypot(qrx - qlx, qry - qly)
        if l_dst < 2:
            return

        ang_dst = math.atan2(qry - qly, qrx - qlx)
        c_dst_x = (qlx + qrx) / 2.0
        c_dst_y = (qly + qry) / 2.0 + shift_y

        # Angle difference (normalized to [-pi, pi])
        delta_theta = ang_dst - ang_src
        while delta_theta > math.pi:
            delta_theta -= 2 * math.pi
        while delta_theta < -math.pi:
            delta_theta += 2 * math.pi

        scale = (l_dst / l_src) * scale_mult

        cos_t = math.cos(delta_theta) * scale
        sin_t = math.sin(delta_theta) * scale

        tx = c_dst_x - (cos_t * c_src_x - sin_t * c_src_y)
        ty = c_dst_y - (sin_t * c_src_x + cos_t * c_src_y)

        M = np.array([[cos_t, -sin_t, tx], [sin_t, cos_t, ty]], dtype=np.float32)

        fh, fw = frame.shape[:2]
        warped = cv2.warpAffine(asset_img, M, (fw, fh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

        # Fast ROI blending for high FPS
        alpha_mask = warped[:, :, 3]
        if np.any(alpha_mask > 0):
            ys, xs = np.where(alpha_mask > 0)
            y1, y2 = max(0, int(ys.min())), min(fh, int(ys.max()) + 1)
            x1, x2 = max(0, int(xs.min())), min(fw, int(xs.max()) + 1)
            if x2 > x1 and y2 > y1:
                sub_a = (alpha_mask[y1:y2, x1:x2].astype(np.float32) / 255.0)[:, :, None]
                sub_rgb = warped[y1:y2, x1:x2, :3]
                frame[y1:y2, x1:x2] = (sub_a * sub_rgb + (1.0 - sub_a) * frame[y1:y2, x1:x2]).astype(np.uint8)

    # =========================================================================
    # Real-Time Garment Fitting (Adheres 100% to Image Label Keypoints)
    # =========================================================================
    def render_worn_items(self, frame, face_lmks, pose_lmks):
        fh, fw = frame.shape[:2]

        # Natural layering order (from body to outer accessories):
        # 1. Suits & Dresses (Torso)
        # 2. Scarf / Wishah (Neck)
        # 3. Mask (Lower face)
        # 4. Hair (Head)
        # 5. Glasses (Eyes)
        # 6. Cap / Graduation Hat (Top of head)
        layer_order = ["suite", "maried", "wishah", "mask", "hair", "glasses", "cap", "graduition"]

        for slot in layer_order:
            item = self.worn_items.get(slot)
            if not item:
                continue

            kps = item.get("keypoints", {})
            if not kps:
                continue

            img = self._load_item_image(item)
            if img is None:
                continue

            dst1 = None
            dst2 = None
            src1 = None
            src2 = None

            # -----------------------------------------------------------------
            # 1. Shoulder Items: Keys "11" & "12" (suite, maried, wishah)
            # -----------------------------------------------------------------
            if "11" in kps and "12" in kps:
                src1 = kps["11"]
                src2 = kps["12"]
                if pose_lmks:
                    ls = get_lmk(pose_lmks, 11)  # Left Shoulder
                    rs = get_lmk(pose_lmks, 12)  # Right Shoulder
                    if ls and rs and (getattr(ls, 'visibility', 1.0) > 0.25) and (getattr(rs, 'visibility', 1.0) > 0.25):
                        dst1 = (ls.x * fw, ls.y * fh)
                        dst2 = (rs.x * fw, rs.y * fh)

            # -----------------------------------------------------------------
            # 2. Eye Items: Keys "2" & "5" (glasses, cap, graduition)
            # -----------------------------------------------------------------
            elif "2" in kps and "5" in kps:
                src1 = kps["2"]
                src2 = kps["5"]
                # 2: Right Eye, 5: Left Eye
                # In FaceMesh: Landmark 33 is Right Eye outer corner, 263 is Left Eye outer corner
                if face_lmks:
                    re = get_lmk(face_lmks, 33)
                    le = get_lmk(face_lmks, 263)
                    if re and le:
                        dst1 = (re.x * fw, re.y * fh)
                        dst2 = (le.x * fw, le.y * fh)
                elif pose_lmks:
                    re = get_lmk(pose_lmks, 2)
                    le = get_lmk(pose_lmks, 5)
                    if re and le and (getattr(re, 'visibility', 1.0) > 0.25):
                        dst1 = (re.x * fw, re.y * fh)
                        dst2 = (le.x * fw, le.y * fh)

            # -----------------------------------------------------------------
            # 3. Hair Wigs & Hairstyles: Keys "9" & "10" (hair) -> Anchored to Temples & Forehead
            # -----------------------------------------------------------------
            elif slot == "hair" and "9" in kps and "10" in kps:
                src1 = kps["9"]
                src2 = kps["10"]
                # In FaceMesh: Landmark 127 is Right Temple, 356 is Left Temple (temple hairline level)
                # This positions the hair naturally on top of the head rather than over the mouth
                if face_lmks:
                    rt = get_lmk(face_lmks, 127)  # Right Temple
                    lt = get_lmk(face_lmks, 356)  # Left Temple
                    if rt and lt:
                        dst1 = (rt.x * fw, rt.y * fh)
                        dst2 = (lt.x * fw, lt.y * fh)
                elif pose_lmks:
                    lear = get_lmk(pose_lmks, 7)  # Left Ear
                    rear = get_lmk(pose_lmks, 8)  # Right Ear
                    if lear and rear and (getattr(lear, 'visibility', 1.0) > 0.25):
                        dst1 = (rear.x * fw, rear.y * fh)
                        dst2 = (lear.x * fw, lear.y * fh)

            # -----------------------------------------------------------------
            # 4. Mask Items: Keys "9" & "10" (mask) -> Anchored to Mouth
            # -----------------------------------------------------------------
            elif slot == "mask" and "9" in kps and "10" in kps:
                src1 = kps["9"]
                src2 = kps["10"]
                # 9: Mouth Left, 10: Mouth Right
                # In FaceMesh: Landmark 61 is Mouth Left, 291 is Mouth Right
                if face_lmks:
                    ml = get_lmk(face_lmks, 61)
                    mr = get_lmk(face_lmks, 291)
                    if ml and mr:
                        dst1 = (ml.x * fw, ml.y * fh)
                        dst2 = (mr.x * fw, mr.y * fh)
                elif pose_lmks:
                    ml = get_lmk(pose_lmks, 9)
                    mr = get_lmk(pose_lmks, 10)
                    if ml and mr and (getattr(ml, 'visibility', 1.0) > 0.25):
                        dst1 = (ml.x * fw, ml.y * fh)
                        dst2 = (mr.x * fw, mr.y * fh)

            # -----------------------------------------------------------------
            # 4. Ear Items: Keys "7" & "8" (some caps)
            # -----------------------------------------------------------------
            elif "7" in kps and "8" in kps:
                src1 = kps["7"]
                src2 = kps["8"]
                if face_lmks:
                    lear = get_lmk(face_lmks, 234)
                    rear = get_lmk(face_lmks, 454)
                    if lear and rear:
                        dst1 = (lear.x * fw, lear.y * fh)
                        dst2 = (rear.x * fw, rear.y * fh)
                elif pose_lmks:
                    lear = get_lmk(pose_lmks, 7)
                    rear = get_lmk(pose_lmks, 8)
                    if lear and rear:
                        dst1 = (lear.x * fw, lear.y * fh)
                        dst2 = (rear.x * fw, rear.y * fh)

            # -----------------------------------------------------------------
            # Render if target landmarks were resolved on the person
            # -----------------------------------------------------------------
            if dst1 is not None and dst2 is not None and src1 is not None and src2 is not None:
                # Custom suit scale & vertical shift fine-tuning applies to suits/dresses
                scale_mult = self.suit_scale if slot in ["suite", "maried"] else 1.0
                shift_y = self.suit_shift_y if slot in ["suite", "maried"] else 0
                self.render_anchored_asset(frame, img, src1, src2, dst1, dst2, slot, scale_mult, shift_y)

    # =========================================================================
    # Rich Visual HUD & Spatial Shelves
    # =========================================================================
    def draw_glass_box(self, canvas, x, y, w, h, bg_rgba=(14, 18, 30, 210), border_bgr=(0, 229, 255), border_thick=1, radius=8):
        x1, y1 = max(0, x), max(0, y)
        x2, y2 = min(canvas.shape[1], x + w), min(canvas.shape[0], y + h)
        if x1 >= x2 or y1 >= y2:
            return

        # Alpha blend background
        overlay = canvas[y1:y2, x1:x2].copy()
        color_bgr = np.array(bg_rgba[:3], dtype=np.float32)
        alpha = bg_rgba[3] / 255.0
        blended = (alpha * color_bgr + (1.0 - alpha) * overlay.astype(np.float32)).astype(np.uint8)
        canvas[y1:y2, x1:x2] = blended

        # Border
        if border_thick > 0 and border_bgr is not None:
            cv2.rectangle(canvas, (x1, y1), (x2, y2), border_bgr, border_thick)

    def draw_spatial_hotspots(self, frame, pil_texts):
        """
        Interactive Spatial Hotspots projected on the 3 panorama walls.
        CRITICAL DESIGN RULE (as requested):
        The walls remain 100% PRISTINE, CLEAN, and FREE of boxes/rectangles.
        Visual highlight and prompt badge ONLY appear when the user's hand cursor
        is actively hovering over that specific item on the wall.
        """
        fh, fw = frame.shape[:2]
        if self.bg_mode != "wall" or getattr(self, "bg_panorama", None) is None:
            return

        scale_x = getattr(self, "current_pano_scale_x", 1.0)
        scale_y = getattr(self, "current_pano_scale_y", 1.0)
        offset_x = getattr(self, "current_pano_offset_x", 0)

        hc = getattr(self, "hand_cursor", None)
        if isinstance(hc, dict) and hc.get("is_visible"):
            hx, hy = hc.get("x", -999), hc.get("y", -999)
            is_pinching = hc.get("is_pinching", False)
        elif isinstance(hc, (tuple, list)) and len(hc) >= 2:
            hx, hy = hc[0], hc[1]
            is_pinching = getattr(self, "is_air_pinching", False)
        else:
            hx, hy = -999, -999
            is_pinching = False

        now = time.time()

        for hs in self.spatial_hotspots:
            # Map panorama pixel coordinates to current screen view
            px1, py1, px2, py2 = hs["rect"]
            sx1 = int(px1 * scale_x) - offset_x
            sx2 = int(px2 * scale_x) - offset_x
            sy1 = int(py1 * scale_y)
            sy2 = int(py2 * scale_y)

            # Check if this item is currently within the visible camera/screen frame
            if sx2 < 0 or sx1 >= fw:
                continue

            # Item information
            cur_cat = hs.get("cat")
            cat_item = hs.get("item_obj")
            if not cur_cat or not cat_item:
                continue

            is_worn = (self.worn_items.get(cur_cat) and self.worn_items[cur_cat].get("id") == cat_item.get("id"))

            # Hover detection with hysteresis to eliminate border jitter / flickering
            pad = 18 if hs.get("_was_hover", False) else 6
            is_hover = (sx1 - pad <= hx <= sx2 + pad and sy1 - pad <= hy <= sy2 + pad)
            hs["_was_hover"] = is_hover

            # Fallback clickable region for mouse click and air pinch
            cur_c = cur_cat
            cur_it = cat_item
            self.clickable_regions.append({
                "rect": (max(0, sx1), max(0, sy1), min(fw, sx2), min(fh, sy2)),
                "action": lambda c=cur_c, it=cur_it: self.wear_item(c, it)
            })

            # ONLY draw visual highlight when the hand is ACTUALLY HOVERING over the item on the wall!
            # When not hovered, the wall is 100% clean and transparent!
            if is_hover:
                bracket_color = (0, 255, 128) if is_worn else hs["color"]
                b_len = 20

                # Soft luminous glow overlay on the hovered wall item
                overlay = frame.copy()
                cv2.rectangle(overlay, (max(0, sx1), max(0, sy1)), (min(fw, sx2), min(fh, sy2)), hs["color"], -1)
                cv2.addWeighted(overlay, 0.20, frame, 0.80, 0, frame)

                # Elegant corner brackets
                cv2.line(frame, (sx1, sy1), (sx1 + b_len, sy1), bracket_color, 2, cv2.LINE_AA)
                cv2.line(frame, (sx1, sy1), (sx1, sy1 + b_len), bracket_color, 2, cv2.LINE_AA)
                cv2.line(frame, (sx2, sy1), (sx2 - b_len, sy1), bracket_color, 2, cv2.LINE_AA)
                cv2.line(frame, (sx2, sy1), (sx2, sy1 + b_len), bracket_color, 2, cv2.LINE_AA)
                cv2.line(frame, (sx1, sy2), (sx1 + b_len, sy2), bracket_color, 2, cv2.LINE_AA)
                cv2.line(frame, (sx1, sy2), (sx1, sy2 - b_len), bracket_color, 2, cv2.LINE_AA)
                cv2.line(frame, (sx2, sy2), (sx2 - b_len, sy2), bracket_color, 2, cv2.LINE_AA)
                cv2.line(frame, (sx2, sy2), (sx2 - b_len, sy2), bracket_color, 2, cv2.LINE_AA)

                # Floating minimal pill badge above the item
                bw = 250
                bh = 46
                bx = max(10, min(fw - bw - 10, (sx1 + sx2 - bw) // 2))
                by = max(55, sy1 - 52)

                is_wearing_wedding = (self.worn_items.get("maried") is not None)
                is_incompatible = is_wearing_wedding and (cur_cat in ["cap", "wishah", "mask"])

                if is_incompatible:
                    badge_border = (80, 80, 240)
                    bracket_color = (80, 80, 240)
                    prompt_txt = "غير متوافق مع فستان العرس"
                    p_col = (140, 160, 255)
                elif is_worn:
                    badge_border = (0, 255, 128)
                    bracket_color = (0, 255, 128)
                    prompt_txt = "مرتداة ✓ - اقرص بالهواء للنزع"
                    p_col = (0, 255, 128)
                else:
                    badge_border = hs["color"]
                    bracket_color = hs["color"]
                    prompt_txt = "اقرص بالهواء لارتدائها"
                    p_col = (0, 229, 255)

                self.draw_glass_box(frame, bx, by, bw, bh, bg_rgba=(10, 14, 26, 235), border_bgr=badge_border, border_thick=2)

                item_title = hs["title"]
                pil_texts.append((item_title, (bx + 12, by + 5), FONT_ITEM, (255, 255, 255)))
                pil_texts.append((prompt_txt, (bx + 12, by + 24), FONT_SHELF_SUB, p_col))

    def draw_rich_ui(self, frame, fps):
        fh, fw = frame.shape[:2]
        self.clickable_regions.clear()

        # We will collect text labels to render with PIL in a single pass for high performance
        pil_texts = []

        # ---------------------------------------------------------------------
        # 1. Top HUD Bar (Ultra-clean Arabic without broken glyphs)
        # ---------------------------------------------------------------------
        self.draw_glass_box(frame, 0, 0, fw, 50, bg_rgba=(12, 16, 26, 220), border_bgr=(30, 40, 60), border_thick=1)

        # Pulse indicator & Title
        cv2.circle(frame, (25, 25), 6, (0, 255, 170), -1)
        pil_texts.append(("استوديو المراية الذكية - الغرفة ثلاثية الجدران", (42, 13), FONT_TITLE, (255, 255, 255)))

        # Top Buttons (Interactive & Clickable)
        top_btn_x = fw - 890
        bg_btn_title = "3 جدران" if self.bg_mode == "wall" else ("عزل ضبابي" if self.bg_mode == "blur" else "كاميرا")
        bg_btn_col = (255, 190, 0) if self.bg_mode == "wall" else ((0, 229, 255) if self.bg_mode == "blur" else (140, 140, 140))
        top_buttons = [
            ("إيماءات اليد" if self.enable_gestures else "معطلة", 100, lambda: self.toggle_gestures(), (0, 255, 170) if self.enable_gestures else (120, 120, 120)),
            (bg_btn_title, 95, lambda: self.toggle_background(), bg_btn_col),
            ("معايرة المركز (R)", 125, lambda: self.calibrate_center(), (255, 200, 0)),
            ("الكاميرا", 80, lambda: self.toggle_camera(), (0, 229, 255)),
            ("التقاط صورة", 90, lambda: self.save_snapshot(frame), (0, 223, 216)),
            ("نزع الكل", 75, lambda: self.clear_all_worn(), (200, 200, 200)),
            ("ملء الشاشة", 90, lambda: self._toggle_fs(), (200, 200, 200)),
            ("خروج", 60, lambda: sys.exit(0), (100, 100, 255))
        ]

        for title, bw, action, b_col in top_buttons:
            bx1, by1, bx2, by2 = top_btn_x, 9, top_btn_x + bw, 41
            self.draw_glass_box(frame, bx1, by1, bw, 32, bg_rgba=(22, 28, 44, 210), border_bgr=b_col, border_thick=1)
            pil_texts.append((title, (bx1 + 8, by1 + 7), FONT_BTN, (255, 255, 255)))
            self.clickable_regions.append({"rect": (bx1, by1, bx2, by2), "action": action})
            top_btn_x += bw + 6

        # ---------------------------------------------------------------------
        # 2. 3-Wall Virtual Room Compass & Gaze Direction Bar
        # ---------------------------------------------------------------------
        comp_w = 700
        comp_h = 32
        comp_x = (fw - comp_w) // 2
        comp_y = 54
        self.draw_glass_box(frame, comp_x, comp_y, comp_w, comp_h, bg_rgba=(10, 14, 24, 210), border_bgr=(40, 60, 90), border_thick=1)

        # Draw compass rail track
        cv2.line(frame, (comp_x + 20, comp_y + 16), (comp_x + comp_w - 20, comp_y + 16), (35, 50, 75), 2, cv2.LINE_AA)

        # 3 Wall Tabs (Clickable to steer view)
        wall_tabs = [
            ("الجدار الأيسر: الأوشحة والشعر", comp_x + 10, 215, "left", -0.85, (0, 229, 255)),
            ("الجدار الأوسط: خزانة الملابس", comp_x + 235, 230, "center", 0.0, (255, 200, 0)),
            ("الجدار الأيمن: النظارات والقبعات", comp_x + 475, 215, "right", 0.85, (255, 0, 127))
        ]

        for w_title, wx, ww, w_key, w_yaw, w_col in wall_tabs:
            is_active = (self.active_wall == w_key)
            tab_bg = (24, 36, 56, 230) if is_active else (14, 18, 28, 170)
            tab_border = w_col if is_active else (50, 65, 90)
            tab_thick = 2 if is_active else 1

            self.draw_glass_box(frame, wx, comp_y + 3, ww, comp_h - 6, bg_rgba=tab_bg, border_bgr=tab_border, border_thick=tab_thick)
            t_col = (255, 255, 255) if is_active else (160, 180, 200)
            pil_texts.append((w_title, (wx + 10, comp_y + 7), FONT_SHELF_SUB, t_col))

            self.clickable_regions.append({
                "rect": (wx, comp_y + 3, wx + ww, comp_y + comp_h - 3),
                "action": lambda y=w_yaw: self.look_at_wall(y)
            })

        # Dynamic glowing indicator needle on the compass rail
        needle_x = int(comp_x + 30 + (self.smooth_yaw + 1.0) * 0.5 * (comp_w - 60))
        needle_y = comp_y + 16
        cv2.circle(frame, (needle_x, needle_y), 7, (0, 255, 255), -1, cv2.LINE_AA)
        cv2.circle(frame, (needle_x, needle_y), 9, (255, 255, 255), 1, cv2.LINE_AA)

        # ---------------------------------------------------------------------
        # 3. Interactive Spatial Hotspots (Direct Hand-to-Wall Touch & Air Pinch)
        # 100% Clean & Invisible when not touched: only lights up when hand is near!
        # ZERO persistent boxes, side panels, or overlay drawers!
        # ---------------------------------------------------------------------
        self.draw_spatial_hotspots(frame, pil_texts)

        # ---------------------------------------------------------------------
        # 4. Suit Fine-Tuning Bar (when suit, wedding dress, or graduation gown is worn)
        # ---------------------------------------------------------------------
        if self.worn_items.get("suite") or self.worn_items.get("maried") or self.worn_items.get("graduition"):
            bar_w = 480
            bar_h = 36
            bar_x = (fw - bar_w) // 2
            bar_y = fh - 50

            self.draw_glass_box(frame, bar_x, bar_y, bar_w, bar_h, bg_rgba=(12, 16, 28, 230), border_bgr=(59, 130, 246), border_thick=1)
            pil_texts.append(("ضبط المقاس:", (bar_x + 12, bar_y + 9), FONT_BTN, (147, 197, 253)))

            # Controls: [-] [%] [+] [Up] [Down] [Reset]
            btn_defs = [
                ("تصغير -", 65, lambda: setattr(self, "suit_scale", max(0.6, self.suit_scale - 0.05))),
                (f"{int(self.suit_scale*100)}%", 45, lambda: None),
                ("تكبير +", 65, lambda: setattr(self, "suit_scale", min(1.8, self.suit_scale + 0.05))),
                ("رفع ^", 50, lambda: setattr(self, "suit_shift_y", self.suit_shift_y - 8)),
                ("خفض v", 50, lambda: setattr(self, "suit_shift_y", self.suit_shift_y + 8)),
                ("إعادة ضبط", 65, lambda: (setattr(self, "suit_scale", 1.0), setattr(self, "suit_shift_y", 0)))
            ]

            bx = bar_x + 105
            for b_txt, bw, b_act in btn_defs:
                self.draw_glass_box(frame, bx, bar_y + 4, bw, 28, bg_rgba=(25, 35, 55, 220), border_bgr=(80, 120, 180), border_thick=1)
                pil_texts.append((b_txt, (bx + 6, bar_y + 7), FONT_SHELF_SUB, (255, 255, 255)))
                self.clickable_regions.append({"rect": (bx, bar_y + 4, bx + bw, bar_y + 32), "action": b_act})
                bx += bw + 6

        # ---------------------------------------------------------------------
        # 5. Toast Notification
        # ---------------------------------------------------------------------
        if time.time() < self.toast_timer and self.toast_message:
            tw = len(self.toast_message) * 14 + 50
            tx = max(20, (fw - tw) // 2)
            ty = 65
            self.draw_glass_box(frame, tx, ty, tw, 40, bg_rgba=(10, 20, 36, 235), border_bgr=(0, 229, 255), border_thick=1)
            pil_texts.append((self.toast_message, (tx + 20, ty + 10), FONT_BTN, (0, 229, 255)))

        # Camera Snapshot Flash
        if self.flash_alpha > 0.0:
            flash_overlay = np.full_like(frame, 255)
            cv2.addWeighted(flash_overlay, self.flash_alpha, frame, 1.0 - self.flash_alpha, 0, frame)
            self.flash_alpha = max(0.0, self.flash_alpha - 0.15)

        # ---------------------------------------------------------------------
        # 6. Air Gesture Guidance Bar (Bottom Floating Hint)
        # ---------------------------------------------------------------------
        if self.enable_gestures and not (self.worn_items.get("suite") or self.worn_items.get("maried")) and not self.show_audio_menu:
            hint_w = 780
            hint_h = 32
            hint_x = (fw - hint_w) // 2
            hint_y = fh - 45
            self.draw_glass_box(frame, hint_x, hint_y, hint_w, hint_h, bg_rgba=(10, 14, 24, 200), border_bgr=(0, 229, 255), border_thick=1)
            hint_str = "إيماءات: اقرص لاختيار الملابس | افتح كفك لقائمة الأصوات 🎵🖐️ | سبابتك على فمك لإيقاف الصوت 🤫"
            pil_texts.append((hint_str, (hint_x + 14, hint_y + 7), FONT_SHELF_SUB, (200, 240, 255)))

        # ---------------------------------------------------------------------
        # 7. Holographic Floating Audio Carousel (Activated via Open Palm)
        # ---------------------------------------------------------------------
        if self.show_audio_menu and self.audio_manager.tracks:
            c_w = 880
            c_h = 115
            c_x = (fw - c_w) // 2
            c_y = fh - 145
            self.draw_glass_box(frame, c_x, c_y, c_w, c_h, bg_rgba=(12, 18, 34, 245), border_bgr=(0, 229, 255), border_thick=2)
            pil_texts.append(("🎵 قائمة المقاطع الصوتية (التفت برأسك للاختيار | افتح كفك للتشغيل والإغلاق 🖐️)", (c_x + 22, c_y + 8), FONT_SHELF_TITLE, (0, 229, 255)))

            num_tracks = len(self.audio_manager.tracks)
            card_w = (c_w - 40 - (num_tracks - 1) * 12) // num_tracks
            card_h = 64
            card_y = c_y + 38

            for idx, trk in enumerate(self.audio_manager.tracks):
                card_x = c_x + 20 + idx * (card_w + 12)
                is_selected = (idx == self.selected_sound_idx)
                is_playing_this = (self.audio_manager.is_playing and self.audio_manager.current_track_idx == idx)

                if is_playing_this:
                    border_c = (0, 255, 128)
                    bg_c = (20, 50, 36, 235)
                elif is_selected:
                    border_c = (0, 229, 255)
                    bg_c = (28, 48, 80, 235)
                else:
                    border_c = (60, 80, 110)
                    bg_c = (16, 22, 38, 210)

                self.draw_glass_box(frame, card_x, card_y, card_w, card_h, bg_rgba=bg_c, border_bgr=border_c, border_thick=2 if is_selected else 1)

                # Fallback click handler
                def make_play(i=idx):
                    self.selected_sound_idx = i
                    self.audio_manager.play_track(i)
                    self.show_audio_menu = False
                    self.toast(f"تم تشغيل: {self.audio_manager.active_track_name} 🎶✨", 3.0)

                self.clickable_regions.append({
                    "rect": (card_x, card_y, card_x + card_w, card_y + card_h),
                    "action": make_play
                })

                t_title = f"{trk['icon']} {trk['title'].split('(')[0].strip()}"
                status_sub = "▶ يعمل الآن" if is_playing_this else ("● محدد للتشغيل" if is_selected else "جاهز")
                sub_col = (0, 255, 128) if is_playing_this else ((0, 229, 255) if is_selected else (160, 180, 200))

                pil_texts.append((t_title, (card_x + 8, card_y + 10), FONT_ITEM, (255, 255, 255)))
                pil_texts.append((status_sub, (card_x + 8, card_y + 36), FONT_SHELF_SUB, sub_col))

        # ---------------------------------------------------------------------
        # 8. Holographic Neon Volume Meter (Activated via Ear Touch)
        # ---------------------------------------------------------------------
        if (time.time() < self.volume_hud_timer) or self.audio_manager.is_playing:
            vw = 230
            vh = 36
            vx = fw - 250
            vy = 58
            self.draw_glass_box(frame, vx, vy, vw, vh, bg_rgba=(12, 16, 28, 230), border_bgr=(0, 229, 255), border_thick=1)
            vol_int = int(self.audio_manager.volume * 100)
            vol_icon = "🔊" if vol_int > 50 else ("🔉" if vol_int > 0 else "🔇")
            pil_texts.append((f"{vol_icon} {vol_int}%", (vx + 10, vy + 8), FONT_BTN, (255, 255, 255)))

            # Volume progress bar
            bar_x = vx + 85
            bar_y = vy + 13
            bar_w = 130
            bar_h = 10
            cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h), (35, 45, 65), -1)
            fill_w = int(bar_w * self.audio_manager.volume)
            if fill_w > 0:
                cv2.rectangle(frame, (bar_x, bar_y), (bar_x + fill_w, bar_y + bar_h), (0, 229, 255), -1)

        # ---------------------------------------------------------------------
        # Render All Text via PIL in Single Pass (Native Crisp Arabic)
        # ---------------------------------------------------------------------
        if pil_texts:
            pil_img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            draw = ImageDraw.Draw(pil_img)
            for txt, pos, font, col in pil_texts:
                ar_txt = format_ar_text(txt)
                draw.text(pos, ar_txt, font=font, fill=(col[2], col[1], col[0]))  # BGR to RGB
            frame[:] = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    def select_drawer(self, cat_id):
        if self.open_drawer == cat_id:
            self.open_drawer = None
        else:
            self.open_drawer = cat_id
            self.drawer_scroll_idx = 0

    def _toggle_fs(self):
        self.is_fullscreen = not self.is_fullscreen
        prop = cv2.WINDOW_FULLSCREEN if self.is_fullscreen else cv2.WINDOW_NORMAL
        cv2.setWindowProperty(self.window_name, cv2.WND_PROP_FULLSCREEN, prop)

    # =========================================================================
    # Hand Gestures & Skeletal Interaction System
    # =========================================================================
    def process_and_draw_hands(self, frame, hand_lmks_list, face_lmks=None, pose_lmks=None):
        fh, fw = frame.shape[:2]
        now = time.time()

        # 1. Continuous Head Yaw Audio Carousel Navigation (When Audio Menu is Open)
        if self.show_audio_menu and self.audio_manager.tracks:
            n_tracks = len(self.audio_manager.tracks)
            # Map head yaw [-0.55, 0.55] across the audio tracks
            clamped_yaw = float(np.clip(self.smooth_yaw, -0.55, 0.55))
            norm_yaw = (clamped_yaw + 0.55) / 1.10
            sel_idx = int(norm_yaw * n_tracks)
            self.selected_sound_idx = int(np.clip(sel_idx, 0, n_tracks - 1))

        if not hand_lmks_list or not self.enable_gestures:
            if now - self.hand_cursor.get("last_seen", 0) > 0.5:
                self.hand_cursor["is_visible"] = False
            return

        self.hand_cursor["last_seen"] = now

        # 2. Draw Skeleton & Glowing Joints for all detected hands
        for hand in hand_lmks_list:
            pts = [(int(lmk.x * fw), int(lmk.y * fh)) for lmk in hand]

            # Draw glowing bones
            for i, j in HAND_CONNECTIONS:
                if i < len(pts) and j < len(pts):
                    p1, p2 = pts[i], pts[j]
                    # Neon cyan glow underlayer
                    cv2.line(frame, p1, p2, (255, 140, 0), 4, cv2.LINE_AA)
                    # Core bright line
                    cv2.line(frame, p1, p2, (255, 240, 200), 2, cv2.LINE_AA)

            # Draw joint nodes
            for idx, pt in enumerate(pts):
                if idx in [4, 8, 12, 16, 20]:  # Fingertips
                    if idx == 8:
                        # Index tip: Highlighted in bright gold/cyan
                        cv2.circle(frame, pt, 6, (0, 255, 255), -1, cv2.LINE_AA)
                    elif idx == 4:
                        # Thumb tip: Bright cyan
                        cv2.circle(frame, pt, 5, (255, 200, 0), -1, cv2.LINE_AA)
                    else:
                        cv2.circle(frame, pt, 4, (255, 0, 180), -1, cv2.LINE_AA)
                else:
                    cv2.circle(frame, pt, 3, (0, 229, 255), -1, cv2.LINE_AA)

        # 3. Open Palm Detection across all detected hands (All 5 Fingers Extended)
        any_open_palm = False
        for hand in hand_lmks_list:
            h_pts = [(int(lmk.x * fw), int(lmk.y * fh)) for lmk in hand]
            w = h_pts[0]

            d0_4 = math.hypot(h_pts[4][0] - w[0], h_pts[4][1] - w[1])    # Thumb tip
            d0_2 = math.hypot(h_pts[2][0] - w[0], h_pts[2][1] - w[1])    # Thumb MCP
            d0_8 = math.hypot(h_pts[8][0] - w[0], h_pts[8][1] - w[1])    # Index tip
            d0_6 = math.hypot(h_pts[6][0] - w[0], h_pts[6][1] - w[1])    # Index PIP
            d0_12 = math.hypot(h_pts[12][0] - w[0], h_pts[12][1] - w[1])  # Middle tip
            d0_10 = math.hypot(h_pts[10][0] - w[0], h_pts[10][1] - w[1])  # Middle PIP
            d0_16 = math.hypot(h_pts[16][0] - w[0], h_pts[16][1] - w[1])  # Ring tip
            d0_14 = math.hypot(h_pts[14][0] - w[0], h_pts[14][1] - w[1])  # Ring PIP
            d0_20 = math.hypot(h_pts[20][0] - w[0], h_pts[20][1] - w[1])  # Pinky tip
            d0_18 = math.hypot(h_pts[18][0] - w[0], h_pts[18][1] - w[1])  # Pinky PIP

            fingers_open = (
                (d0_4 > d0_2 * 1.15) and
                (d0_8 > d0_6 * 1.12) and
                (d0_12 > d0_10 * 1.12) and
                (d0_16 > d0_14 * 1.12) and
                (d0_20 > d0_18 * 1.12)
            )
            d_pinch = math.hypot(h_pts[4][0] - h_pts[8][0], h_pts[4][1] - h_pts[8][1])
            h_scale = max(20.0, float(np.hypot(w[0] - h_pts[9][0], w[1] - h_pts[9][1])))

            if fingers_open and (d_pinch > 45) and (h_scale > 35):
                any_open_palm = True
                palm_center = ((w[0] + h_pts[9][0]) // 2, (w[1] + h_pts[9][1]) // 2)
                cv2.circle(frame, palm_center, 18, (0, 229, 255), 2, cv2.LINE_AA)
                cv2.circle(frame, palm_center, 24, (255, 255, 255), 1, cv2.LINE_AA)
                break

        # Open Palm Rising Edge Trigger (Debounced Single-Shot)
        just_opened_palm = any_open_palm and not self.prev_palm_state and (now - self.last_palm_time > 0.75)
        if just_opened_palm:
            self.last_palm_time = now
            if not self.show_audio_menu:
                # 1st Open Palm: Open horizontal floating audio dock
                self.show_audio_menu = True
                self.toast("🎵 تم فتح قائمة المقاطع الصوتية (التفت برأسك للاختيار) 🖐️", 3.0)
            else:
                # 2nd Open Palm: Confirm & play selected track, then smoothly close dock
                self.audio_manager.play_track(self.selected_sound_idx)
                self.show_audio_menu = False
                self.toast(f"تم تشغيل: {self.audio_manager.active_track_name} 🎶✨", 3.0)

        self.prev_palm_state = any_open_palm

        # 4. Resolve Head Landmarks for Face Gestures (Lips & Ears)
        mouth_pt = None
        ear_r_pt = None
        ear_l_pt = None

        if face_lmks:
            m13 = get_lmk(face_lmks, 13)
            m14 = get_lmk(face_lmks, 14)
            if m13 and m14:
                mouth_pt = (int((m13.x + m14.x) * 0.5 * fw), int((m13.y + m14.y) * 0.5 * fh))

            lr = get_lmk(face_lmks, 234)  # Right ear tragus
            ll = get_lmk(face_lmks, 454)  # Left ear tragus
            if lr:
                ear_r_pt = (int(lr.x * fw), int(lr.y * fh))
            if ll:
                ear_l_pt = (int(ll.x * fw), int(ll.y * fh))

        if mouth_pt is None and pose_lmks:
            p9 = get_lmk(pose_lmks, 9)
            p10 = get_lmk(pose_lmks, 10)
            if p9 and p10:
                mouth_pt = (int((p9.x + p10.x) * 0.5 * fw), int((p9.y + p10.y) * 0.5 * fh))

        if ear_r_pt is None and pose_lmks:
            pr = get_lmk(pose_lmks, 8)
            if pr:
                ear_r_pt = (int(pr.x * fw), int(pr.y * fh))

        if ear_l_pt is None and pose_lmks:
            pl = get_lmk(pose_lmks, 7)
            if pl:
                ear_l_pt = (int(pl.x * fw), int(pl.y * fh))

        # 5. Face/Body Touch Gestures (Shhh Stop & Ear Volume Controls)
        for hand in hand_lmks_list:
            h_idx_pt = (int(hand[8].x * fw), int(hand[8].y * fh))

            # A. Index on Lips: Complete Stop ("Shhh" Gesture)
            if mouth_pt:
                d_mouth = math.hypot(h_idx_pt[0] - mouth_pt[0], h_idx_pt[1] - mouth_pt[1])
                if d_mouth < 45:
                    cv2.circle(frame, mouth_pt, 22, (255, 0, 180), 2, cv2.LINE_AA)
                    cv2.circle(frame, mouth_pt, 28, (255, 255, 255), 1, cv2.LINE_AA)
                    if self.audio_manager.is_playing and (now - self.last_mute_time > 0.6):
                        self.last_mute_time = now
                        self.audio_manager.stop()
                        self.toast("🤫 تم إيقاف الصوت تماماً (Shhh)", 2.5)

            # B. Right Index on Right Ear: Volume UP (+10% per single touch)
            if ear_r_pt:
                d_ear_r = math.hypot(h_idx_pt[0] - ear_r_pt[0], h_idx_pt[1] - ear_r_pt[1])
                if d_ear_r < 52:
                    cv2.circle(frame, ear_r_pt, 24, (0, 255, 128), 3, cv2.LINE_AA)
                    cv2.circle(frame, ear_r_pt, 30, (255, 255, 255), 1, cv2.LINE_AA)
                    if now - self.last_vol_time > 0.6:
                        self.last_vol_time = now
                        self.audio_manager.adjust_volume(+0.10)
                        self.volume_hud_timer = now + 3.0
                        self.toast(f"🔊 رفع الصوت (+10%): {int(self.audio_manager.volume * 100)}%", 1.5)

            # C. Left Index on Left Ear: Volume DOWN (-10% per single touch)
            if ear_l_pt:
                d_ear_l = math.hypot(h_idx_pt[0] - ear_l_pt[0], h_idx_pt[1] - ear_l_pt[1])
                if d_ear_l < 52:
                    cv2.circle(frame, ear_l_pt, 24, (0, 229, 255), 3, cv2.LINE_AA)
                    cv2.circle(frame, ear_l_pt, 30, (255, 255, 255), 1, cv2.LINE_AA)
                    if now - self.last_vol_time > 0.6:
                        self.last_vol_time = now
                        self.audio_manager.adjust_volume(-0.10)
                        self.volume_hud_timer = now + 3.0
                        self.toast(f"🔉 خفض الصوت (-10%): {int(self.audio_manager.volume * 100)}%", 1.5)

        # 6. Select primary interactive hand for Try-on cursor & Pinching
        primary_hand = hand_lmks_list[0]
        for hand in hand_lmks_list:
            t = hand[4]
            idx = hand[8]
            d = np.hypot(t.x - idx.x, t.y - idx.y)
            if d < 0.08:
                primary_hand = hand
                break

        pts = [(int(lmk.x * fw), int(lmk.y * fh)) for lmk in primary_hand]
        pt0 = pts[0]    # Wrist
        pt4 = pts[4]    # Thumb tip
        pt5 = pts[5]    # Index MCP
        pt6 = pts[6]    # Index PIP
        pt8 = pts[8]    # Index tip
        pt9 = pts[9]    # Middle MCP
        pt10 = pts[10]  # Middle PIP
        pt12 = pts[12]  # Middle tip

        # Ultra-Fast 3D Euclidean Contact Distance between Thumb and Index Tips
        lm4 = primary_hand[4]
        lm8 = primary_hand[8]
        dx_3d = lm4.x - lm8.x
        dy_3d = lm4.y - lm8.y
        dz_3d = getattr(lm4, 'z', 0.0) - getattr(lm8, 'z', 0.0)
        dist_3d = math.sqrt(dx_3d * dx_3d + dy_3d * dy_3d + dz_3d * dz_3d)

        hand_scale = max(20.0, float(np.hypot(pt0[0] - pt9[0], pt0[1] - pt9[1])))
        pinch_dist = float(np.hypot(pt4[0] - pt8[0], pt4[1] - pt8[1]))
        pinch_ratio = pinch_dist / hand_scale

        # Ultra-responsive contact detection (fast 3D + 2D hybrid threshold)
        is_contact = (dist_3d < 0.065) or (pinch_dist < 46) or (pinch_ratio < 0.32)

        # Gesture recognition with Schmitt-Trigger Hysteresis (prevents pinch jitter / flickering)
        was_pinching = self.hand_cursor.get("is_pinching", False)
        if was_pinching:
            # Releasing pinch requires clear deliberate finger separation
            is_pinching = (dist_3d < 0.085) or (pinch_dist < 58) or (pinch_ratio < 0.40)
        else:
            # Engaging pinch: instant trigger on touch
            is_pinching = is_contact

        # Pointing: Index extended & middle curled
        is_pointing = (pt8[1] < pt6[1]) and (pt12[1] > pt10[1] - 8)

        if is_pointing:
            raw_cx, raw_cy = pt8[0], pt8[1]
        else:
            raw_cx, raw_cy = (pt4[0] + pt8[0]) // 2, (pt4[1] + pt8[1]) // 2

        # Adaptive Cursor Smoothing with tremor deadband (kills hand jitter)
        if not self.hand_cursor["is_visible"]:
            cx, cy = raw_cx, raw_cy
        else:
            prev_x, prev_y = self.hand_cursor["x"], self.hand_cursor["y"]
            move_dist = math.hypot(raw_cx - prev_x, raw_cy - prev_y)
            if move_dist < 3.0:
                # Sub-pixel hand tremor: lock cursor steady
                cx, cy = prev_x, prev_y
            elif move_dist < 22.0:
                # Fine adjustments / hovering over items: smooth glide
                cx = int(0.75 * prev_x + 0.25 * raw_cx)
                cy = int(0.75 * prev_y + 0.25 * raw_cy)
            else:
                # Fast intentional hand motion: responsive tracking
                cx = int(0.40 * prev_x + 0.60 * raw_cx)
                cy = int(0.40 * prev_y + 0.60 * raw_cy)

        self.hand_cursor["x"] = cx
        self.hand_cursor["y"] = cy
        self.hand_cursor["is_visible"] = True
        self.hand_cursor["is_pointing"] = is_pointing
        self.hand_cursor["is_pinching"] = is_pinching
        self.hand_cursor["pinch_ratio"] = pinch_ratio

        # 7. Air Pinch: Instant Click & Grab item (Rising Edge Trigger - Single Frame Activation)
        just_pinched = is_pinching and not self.prev_pinching and (now - self.last_pinch_time > 0.18)
        if just_pinched:
            self.last_pinch_time = now
            for reg in self.clickable_regions:
                rx1, ry1, rx2, ry2 = reg["rect"]
                if rx1 <= cx <= rx2 and ry1 <= cy <= ry2:
                    reg["action"]()
                    break

        self.prev_pinching = is_pinching

        # 8. Render Clean Minimalist Micro-Pointer (Zero Rings, Zero Clutter)
        cursor_col = (0, 255, 128) if is_pinching else ((0, 229, 255) if is_pointing else (255, 200, 0))

        if is_pinching:
            # Elegant luminous connection beam between contact tips
            cv2.line(frame, pt4, pt8, (0, 255, 128), 3, cv2.LINE_AA)
            cv2.circle(frame, (cx, cy), 6, (0, 255, 128), -1, cv2.LINE_AA)
            cv2.circle(frame, (cx, cy), 8, (255, 255, 255), 1, cv2.LINE_AA)
        else:
            # Clean sleek micro-reticle
            cv2.circle(frame, (cx, cy), 4, cursor_col, -1, cv2.LINE_AA)
            cv2.circle(frame, (cx, cy), 6, (255, 255, 255), 1, cv2.LINE_AA)

    # =========================================================================
    # Main Application Loop
    # =========================================================================
    def run(self):
        cv2.namedWindow(self.window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(self.window_name, 1280, 720)
        cv2.setMouseCallback(self.window_name, self.on_mouse)

        self.start_camera("local")
        prev_time = time.time()

        print("\n" + "=" * 70)
        print("  VISIONCRAFT AR SMART MIRROR & 3-WALL PANORAMIC STUDIO ACTIVATED")
        print("=" * 70)
        print(" * الغرفة الافتراضية ثلاثية الجدران (3-Wall Panoramic Dressing Room):")
        print("   - الجدار الأيسر: الأوشحة الملكية وتراكيب الشعر والأقنعة 🧣💇😷")
        print("   - الجدار الأوسط: خزانة البدلات الفاخرة وفساتين المناسبات وأرواب التخرج 👔👰🎓")
        print("   - الجدار الأيمن: رف النظارات الفاخرة والكوافي والقبعات 👓🧢")
        print(" * تتبع دوران الرأس والعين: التفِت يميناً أو يساراً لتحريك زاوية الرؤية بسلاسة تامة")
        print(" * [R]             معايرة وتثبيت زاوية النظر إلى المركز (Center Calibration)")
        print(" * [B]             تبديل عزل الخلفية (الغرفة ثلاثية الجدران / عزل ضبابي / كاميرا واقعية)")
        print(" * [ [ ] / [ ] ]   ضبط دقة وحساسية عزل الخلفية بالذكاء الاصطناعي (تشديد/توسيع القص)")
        print(" * [G]             تشغيل / إيقاف إيماءات اليد والحركة (Air Gestures)")
        print(" * [C]             تبديل الكاميرا (كاميرا الكمبيوتر <-> كاميرا الجوال)")
        print(" * [1] - [8]       فتح الرفوف والانتقال المباشر إلى جدارها المخصص")
        print(" * [S]             التقاط وحفظ صورة عالية الدقة داخل snapshots/")
        print(" * [X]             نزع كافة الملابس والأكسسوارات المرتداة")
        print(" * [F]             ملء الشاشة")
        print(" * [Q] / [ESC]     إغلاق البرنامج")
        print("=" * 70 + "\n")

        while True:
            ret, raw_frame = self.cap.read()
            if not ret or raw_frame is None:
                time.sleep(0.03)
                continue

            frame = cv2.flip(raw_frame, 1)
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            face_lmks = None
            pose_lmks = None
            hand_lmks_list = None

            if HAS_MEDIAPIPE:
                mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

                if self.face_landmarker:
                    try:
                        res = self.face_landmarker.detect(mp_img)
                        if res and res.face_landmarks:
                            face_lmks = res.face_landmarks[0]
                    except Exception:
                        pass

                if self.pose_landmarker:
                    try:
                        res = self.pose_landmarker.detect(mp_img)
                        if res and res.pose_landmarks:
                            pose_lmks = res.pose_landmarks[0]
                    except Exception:
                        pass

                if self.hand_landmarker and self.enable_gestures:
                    try:
                        res_h = self.hand_landmarker.detect(mp_img)
                        if res_h and res_h.hand_landmarks:
                            hand_lmks_list = res_h.hand_landmarks
                    except Exception:
                        pass

                # 1. Track Continuous Head Yaw & Eye Gaze Rotation Across the 3 Walls
                self.compute_head_and_gaze_yaw(face_lmks, frame.shape[1], frame.shape[0])

                # 2. Virtual Background Replacement (3-Wall Panoramic Room / Bokeh Blur)
                if self.bg_mode != "none":
                    self.apply_virtual_background(frame, mp_img, pose_lmks=pose_lmks, hand_lmks_list=hand_lmks_list)

            # 3. Render Worn Accessories & Clothes onto the body
            self.render_worn_items(frame, face_lmks, pose_lmks)

            # 4. Draw Rich Glassmorphic UI with 3-Wall Compass & Dynamic Shelves
            curr_time = time.time()
            fps = 1.0 / max(0.001, curr_time - prev_time)
            prev_time = curr_time

            if self.show_hud:
                self.draw_rich_ui(frame, fps)

            # 5. Process & Draw Hand Skeletal Tracking and Air Gestures
            self.process_and_draw_hands(frame, hand_lmks_list, face_lmks=face_lmks, pose_lmks=pose_lmks)

            cv2.imshow(self.window_name, frame)

            key = cv2.waitKey(1) & 0xFF
            if key in [27, ord('q'), ord('Q')]:
                break
            elif key in [ord('r'), ord('R')]:
                self.calibrate_center()
            elif key in [ord('b'), ord('B')]:
                self.toggle_background()
            elif key in [ord('g'), ord('G')]:
                self.toggle_gestures()
            elif key in [ord('m'), ord('M')]:
                self.show_audio_menu = not self.show_audio_menu
                self.toast("قائمة المقاطع الصوتية 🎵" if self.show_audio_menu else "إغلاق قائمة الصوت", 2.0)
            elif key in [ord('+'), ord('=')]:
                self.audio_manager.adjust_volume(+0.10)
                self.volume_hud_timer = time.time() + 3.0
                self.toast(f"🔊 رفع الصوت (+10%): {int(self.audio_manager.volume * 100)}%", 1.5)
            elif key in [ord('-'), ord('_')]:
                self.audio_manager.adjust_volume(-0.10)
                self.volume_hud_timer = time.time() + 3.0
                self.toast(f"🔉 خفض الصوت (-10%): {int(self.audio_manager.volume * 100)}%", 1.5)
            elif key in [ord('c'), ord('C')]:
                self.toggle_camera()
            elif key in [ord('s'), ord('S')]:
                self.save_snapshot(frame)
            elif key in [ord('x'), ord('X')]:
                self.clear_all_worn()
            elif key in [ord('f'), ord('F')]:
                self._toggle_fs()
            elif key == ord('['):
                self.seg_threshold = max(0.20, round(self.seg_threshold - 0.05, 2))
                self.toast(f"حساسية العزل: {int(self.seg_threshold * 100)}% (توسيع العزل) 🪄", 2.0)
            elif key == ord(']'):
                self.seg_threshold = min(0.95, round(self.seg_threshold + 0.05, 2))
                self.toast(f"حساسية العزل: {int(self.seg_threshold * 100)}% (تشديد دقة القص) ✂️", 2.0)
            elif ord('1') <= key <= ord('8'):
                idx = key - ord('1')
                if idx < len(self.shelf_categories):
                    cat = self.shelf_categories[idx]
                    self.select_drawer(cat["id"])
                    # Pan to the designated wall
                    if cat.get("wall") == "left":
                        self.look_at_wall(-0.85)
                    elif cat.get("wall") == "right":
                        self.look_at_wall(0.85)
                    else:
                        self.look_at_wall(0.0)

        if self.cap is not None:
            self.cap.release()
        cv2.destroyAllWindows()
        print("[*] تم إغلاق استوديو الواقع المعزز بنجاح.")


def main():
    parser = argparse.ArgumentParser(description="VisionCraft Standalone AR Smart Mirror & Try-On Studio (Python Native)")
    parser.add_argument("--ipcam", type=str, default="http://192.168.8.106:8080/video", help="URL of Mobile IP Webcam Stream")
    args = parser.parse_args()

    app = ARStudioEngine(ipcam_url=args.ipcam)
    app.run()


if __name__ == "__main__":
    main()
