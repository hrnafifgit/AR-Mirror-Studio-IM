import sys
import os

# Add studio directory to python path
STUDIO_DIR = os.path.abspath(os.path.dirname(__file__))
sys.path.insert(0, STUDIO_DIR)

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from run_ar_studio import main

if __name__ == "__main__":
    banner = """
    ========================================================================
         VISIONCRAFT - AR SMART MIRROR & VIRTUAL TRY-ON STUDIO
    ========================================================================
    * High-Performance Realtime Native Desktop Mirror (60 FPS)
    * AI Landmark Tracking: MediaPipe Face Mesh, Pose & Hands
    * Virtual Try-On: Suits, Traditional Yemeni Outfits, Caps, Glasses
    * Dual Camera: Local Webcam + Mobile IP Webcam
    ========================================================================
    """
    print(banner)
    main()
