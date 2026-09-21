/**
 * ==============================================================================
 * VisionCraft Studio - AR UI & Canvas Rendering Engine (محرك واجهة المراية الذكية)
 * ==============================================================================
 * Responsibilities:
 * 1. Geometric Rounded Rectangles & Glassmorphism Drawing
 * 2. Lateral Spatial Shelves (الأرفف المكانية الجانبية)
 * 3. Vertical Popout Drawers & Item Cards (القوائم المنسدلة للأزياء والأصول)
 * 4. Hand Cursor HUD & Gesture Feedback (المؤشر الفضائي وشارات التفاعل)
 * 5. Metrics & Anthropometric HUD Overlay (شريط القياسات والأبعاد وأزرار التحكم)
 * ==============================================================================
 */

class ARUIManager {
    /**
     * رسم مستطيل بحواف دائرية أنيقة
     */
    static roundRect(ctx, x, y, width, height, radius, fill = true, stroke = true) {
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

    /**
     * رسم مؤشر اليد الفضائي
     */
    static renderHandCursor(ctx, handCursor) {
        if (!handCursor || !handCursor.isVisible) return;

        const isPinch = handCursor.isPinching;
        const isHolding = handCursor.isHolding;
        const x = handCursor.x;
        const y = handCursor.y;

        ctx.save();

        // 1. الحلقة الخارجية المتوهجة
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

        // 2. النقطة المركزية
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = "#ffffff";
        ctx.shadowBlur = 4;
        ctx.shadowColor = "#ffffff";
        ctx.fill();

        // 3. شارة الحالة
        if (isHolding) {
            ctx.font = "bold 9px Segoe UI, sans-serif";
            ctx.fillStyle = "#ec4899";
            ctx.fillText("✊ GRAB", x + 24, y + 4);
        } else if (isPinch) {
            ctx.font = "bold 9px Segoe UI, sans-serif";
            ctx.fillStyle = "#00e5ff";
            ctx.fillText("🤏 PINCH", x + 24, y + 4);
        } else if (handCursor.isPointing) {
            ctx.font = "bold 9px Segoe UI, sans-serif";
            ctx.fillStyle = "#00e5ff";
            ctx.fillText("👆 POINTER", x + 24, y + 4);

            ctx.beginPath();
            ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y);
            ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14);
            ctx.strokeStyle = "rgba(0, 229, 255, 0.85)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.restore();
    }
}

window.ARUIManager = ARUIManager;
