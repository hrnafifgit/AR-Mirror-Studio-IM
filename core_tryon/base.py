import time
import base64
import io
import cv2
import numpy as np

class ProcessingResult:
    """
    حاوية معيارية لنتائج معالجة الصور الرقمية
    تحتوي على مصفوفة الصورة الناتجة، بيانات الهستوغرام الحي، الإحصائيات الرياضية،
    المعادلة الرياضية، وكود بايثون المقابل، وزمن التنفيذ بالملي ثانية.
    """
    def __init__(self, image: np.ndarray, formula: str = "", code: str = "", start_time: float = 0.0):
        self.image = image
        self.formula = formula
        self.code = code
        self.execution_time_ms = round((time.perf_counter() - start_time) * 1000, 2) if start_time else 0.0
        self.histogram = self._calculate_histogram(image)
        self.stats = self._calculate_stats(image)

    def _calculate_histogram(self, img: np.ndarray) -> dict:
        hist_data = {}
        if len(img.shape) == 2 or img.shape[2] == 1:
            # صورة رمادية
            gray = img if len(img.shape) == 2 else img[:, :, 0]
            h, _ = np.histogram(gray, bins=64, range=(0, 256))
            hist_data["gray"] = h.tolist()
            hist_data["r"] = hist_data["gray"]
            hist_data["g"] = hist_data["gray"]
            hist_data["b"] = hist_data["gray"]
        else:
            # صورة ملونة BGR
            for i, col in enumerate(["b", "g", "r"]):
                h, _ = np.histogram(img[:, :, i], bins=64, range=(0, 256))
                hist_data[col] = h.tolist()
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            h_gray, _ = np.histogram(gray, bins=64, range=(0, 256))
            hist_data["gray"] = h_gray.tolist()
        return hist_data

    def _calculate_stats(self, img: np.ndarray) -> dict:
        gray = img if len(img.shape) == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        mean_val = float(np.mean(gray))
        std_val = float(np.std(gray))
        median_val = float(np.median(gray))

        # حساب الإنتروبيا (Entropy)
        hist, _ = np.histogram(gray, bins=256, range=(0, 256), density=True)
        hist = hist[hist > 0]
        entropy_val = float(-np.sum(hist * np.log2(hist))) if len(hist) > 0 else 0.0

        return {
            "mean": round(mean_val, 2),
            "std_dev": round(std_val, 2),
            "median": round(median_val, 2),
            "entropy": round(entropy_val, 2),
            "width": img.shape[1],
            "height": img.shape[0],
            "channels": 1 if len(img.shape) == 2 else img.shape[2]
        }

    def to_base64(self, format=".png") -> str:
        success, buffer = cv2.imencode(format, self.image)
        if not success:
            raise ValueError("Failed to encode processed image.")
        return f"data:image/{format.replace('.', '')};base64," + base64.b64encode(buffer).decode("utf-8")

    def to_dict(self) -> dict:
        return {
            "image": self.to_base64(),
            "histogram": self.histogram,
            "stats": self.stats,
            "execution_time_ms": self.execution_time_ms,
            "formula": self.formula,
            "code": self.code
        }
