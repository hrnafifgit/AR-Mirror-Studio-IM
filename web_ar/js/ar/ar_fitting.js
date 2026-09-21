/**
 * ==============================================================================
 * VisionCraft Studio - AR Fitting & Geometric Engine (المحرك الحسابي والتشريحي)
 * ==============================================================================
 * Responsibilities:
 * 1. Adaptive Jitter Reduction (مرشحات التنعيم المتكيفة اللحظية)
 * 2. Anthropometric Depth Estimation (تقدير العمق الفيزيائي للوجه والجسم)
 * 3. 2-Point Anchor Warping & Alignment (المحاذاة الهندسية وتثبيت المعالم)
 * 4. Snap-to-Body Gravitational Fields (حقول الجاذبية الافتراضية للارتداء التلقائي)
 * ==============================================================================
 */

class ARFittingEngine {
    /**
     * تنعيم الإحداثيات الأساسي
     */
    static smooth(current, target, alpha = 0.75) {
        if (current === null || current === undefined || isNaN(current)) return target;
        return current * alpha + target * (1.0 - alpha);
    }

    /**
     * تنعيم الحركة المتكيفة الذكية (Adaptive EMA Jitter Filter)
     */
    static smoothAdaptive(current, target, minAlpha = 0.45, maxAlpha = 0.88, threshold = 8.0) {
        if (current === null || current === undefined || isNaN(current)) return target;
        const diff = Math.abs(target - current);
        const factor = Math.min(1.0, diff / threshold);
        const alpha = maxAlpha - factor * (maxAlpha - minAlpha);
        return current * alpha + target * (1.0 - alpha);
    }

    /**
     * تنعيم الزوايا المتكيف مع معالجة الانتقال الدوري (-PI إلى +PI)
     */
    static smoothAngleAdaptive(current, target, minAlpha = 0.50, maxAlpha = 0.88, threshold = 0.15) {
        if (current === null || current === undefined || isNaN(current)) return target;
        let diff = target - current;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const factor = Math.min(1.0, Math.abs(diff) / threshold);
        const alpha = maxAlpha - factor * (maxAlpha - minAlpha);
        return current + diff * (1.0 - alpha);
    }

    /**
     * تقدير العمق الفيزيائي للوجه عبر المسافة بين البؤبؤين
     */
    static computeFaceAnthropometricDepth(faceLandmarks, w, h, focalRatio, humanIpdCm, depthMetrics) {
        if (!faceLandmarks) return;
        const leftEyePt = faceLandmarks[468] || faceLandmarks[33];
        const rightEyePt = faceLandmarks[473] || faceLandmarks[263];
        if (!leftEyePt || !rightEyePt) return;

        const lx = (1.0 - leftEyePt.x) * w;
        const ly = leftEyePt.y * h;
        const rx = (1.0 - rightEyePt.x) * w;
        const ry = rightEyePt.y * h;

        const rawIpd = Math.hypot(rx - lx, ry - ly);
        if (rawIpd > 10) {
            const ipdPixels = this.smoothAdaptive(depthMetrics.ipdPixels, rawIpd, 0.50, 0.88, 5.0);
            const focalLength = w * focalRatio;
            const depthCm = (focalLength * humanIpdCm) / ipdPixels;
            depthMetrics.ipdPixels = ipdPixels;
            depthMetrics.faceDepthCm = Math.round(depthCm * 10) / 10;
        }
    }

    /**
     * تقدير العمق الفيزيائي للجسم عبر المسافة بين الأكتاف
     */
    static computeBodyAnthropometricDepth(poseLandmarks, w, h, focalRatio, humanShoulderCm, depthMetrics) {
        if (!poseLandmarks) return;
        const leftSh = poseLandmarks[11];
        const rightSh = poseLandmarks[12];

        if (leftSh && rightSh && (leftSh.visibility === undefined || leftSh.visibility > 0.35) &&
            (rightSh.visibility === undefined || rightSh.visibility > 0.35)) {
            const lsx = (1.0 - leftSh.x) * w;
            const lsy = leftSh.y * h;
            const rsx = (1.0 - rightSh.x) * w;
            const rsy = rightSh.y * h;

            const rawShoulders = Math.hypot(rsx - lsx, rsy - lsy);
            if (rawShoulders > 30) {
                const shoulderPixels = this.smoothAdaptive(depthMetrics.shoulderPixels, rawShoulders, 0.50, 0.88, 8.0);
                const focalLength = w * focalRatio;
                const depthCm = (focalLength * humanShoulderCm) / shoulderPixels;
                depthMetrics.shoulderPixels = shoulderPixels;
                depthMetrics.bodyDepthCm = Math.round(depthCm * 10) / 10;
            }
        }
    }

    /**
     * رسم القطعة وتثبيتها بدقة على نقطتي ارتكاز مع التدوير والمقياس
     */
    static renderAnchoredAsset(ctx, assetImg, kp1, kp2, rawDstP1, rawDstP2, categoryName, scaleMultiplier = 1.0, shiftX = 0, shiftY = 0, smoothedAnchors = null) {
        if (!assetImg || !assetImg.complete) return false;
        const nw = assetImg.naturalWidth || assetImg.width;
        const nh = assetImg.naturalHeight || assetImg.height;

        const p1x = kp1[0] * nw, p1y = kp1[1] * nh;
        const p2x = kp2[0] * nw, p2y = kp2[1] * nh;

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

        let rawQLx, rawQLy, rawQRx, rawQRy;
        if (rawDstP1.x <= rawDstP2.x) {
            rawQLx = rawDstP1.x; rawQLy = rawDstP1.y;
            rawQRx = rawDstP2.x; rawQRy = rawDstP2.y;
        } else {
            rawQLx = rawDstP2.x; rawQLy = rawDstP2.y;
            rawQRx = rawDstP1.x; rawQRy = rawDstP1.y;
        }

        let qLx = rawQLx, qLy = rawQLy, qRx = rawQRx, qRy = rawQRy;
        if (smoothedAnchors) {
            if (!smoothedAnchors[categoryName]) {
                smoothedAnchors[categoryName] = { qLx: null, qLy: null, qRx: null, qRy: null };
            }
            const cache = smoothedAnchors[categoryName];
            qLx = this.smoothAdaptive(cache.qLx, rawQLx, 0.45, 0.86, 6.0);
            qLy = this.smoothAdaptive(cache.qLy, rawQLy, 0.45, 0.86, 6.0);
            qRx = this.smoothAdaptive(cache.qRx, rawQRx, 0.45, 0.86, 6.0);
            qRy = this.smoothAdaptive(cache.qRy, rawQRy, 0.45, 0.86, 6.0);
            cache.qLx = qLx; cache.qLy = qLy;
            cache.qRx = qRx; cache.qRy = qRy;
        }

        const L_dst = Math.hypot(qRx - qLx, qRy - qLy);
        if (L_dst < 2) return false;

        const ang_dst = Math.atan2(qRy - qLy, qRx - qLx);
        const c_dst_x = (qLx + qRx) / 2.0 + shiftX;
        const c_dst_y = (qLy + qRy) / 2.0 + shiftY;

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
}

window.ARFittingEngine = ARFittingEngine;
