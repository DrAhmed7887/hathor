#!/usr/bin/env python3
"""Generate synthetic vaccination-card OCR fixtures.

The generated cards are deliberately mock documents: fictional identifiers,
invented dates, and recreated layouts only. They are suitable for regression
tests that need predictable vaccination rows without using real child records.
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
except ImportError:  # pragma: no cover - local generation still works without shaping.
    arabic_reshaper = None
    get_display = None


OUT_DIR = Path(__file__).resolve().parent
WIDTH = 1600
HEIGHT = 1050
SEED = 20260424

WESTERN_TO_ARABIC_INDIC = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")
WESTERN_TO_PERSIAN_INDIC = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


@dataclass(frozen=True)
class Dose:
    row_id: str
    visit: str
    antigen: str
    dose_number: str | None
    dose_kind: str
    date: str | None
    raw_date_text: str | None
    lot_number: str | None
    confidence: float
    reasoning_if_uncertain: str | None = None
    preserve_duplicate: bool = False


def font(size: int, bold: bool = False, italic: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "",
        "/System/Library/Fonts/Supplemental/Arial Italic.ttf" if italic else "",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default(size=size)


def first_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return font(size)


FONTS = {
    "title": font(43, bold=True),
    "subtitle": font(29),
    "label": font(25, bold=True),
    "body": font(24),
    "small": font(20),
    "hand": font(25, italic=True),
    "hand_en": first_font(
        [
            "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
            "/System/Library/Fonts/Noteworthy.ttc",
            "/System/Library/Fonts/MarkerFelt.ttc",
            "/System/Library/Fonts/Supplemental/Comic Sans MS.ttf",
        ],
        30,
    ),
    "hand_en_small": first_font(
        [
            "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
            "/System/Library/Fonts/Noteworthy.ttc",
            "/System/Library/Fonts/MarkerFelt.ttc",
            "/System/Library/Fonts/Supplemental/Comic Sans MS.ttf",
        ],
        24,
    ),
    "hand_ar": first_font(
        [
            "/Library/Fonts/Arial Unicode.ttf",
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/System/Library/Fonts/GeezaPro.ttc",
            "/System/Library/Fonts/SFArabic.ttf",
        ],
        31,
    ),
    "stamp": font(27, bold=True),
}


def shape_text(text: str) -> str:
    if (
        arabic_reshaper is not None
        and get_display is not None
        and any("\u0600" <= char <= "\u06ff" for char in text)
    ):
        return get_display(arabic_reshaper.reshape(text))
    return text


def draw_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    *,
    fill: tuple[int, int, int] = (29, 43, 53),
    font_key: str = "body",
    anchor: str | None = None,
) -> None:
    draw.text(xy, shape_text(text), fill=fill, font=FONTS[font_key], anchor=anchor)


def draw_hand_text(
    image: Image.Image,
    xy: tuple[int, int],
    text: str,
    *,
    font_key: str = "hand_en",
    fill: tuple[int, int, int, int] = (24, 37, 64, 235),
    angle: float = -3.0,
) -> None:
    shaped = shape_text(text)
    text_font = FONTS[font_key]
    bbox = ImageDraw.Draw(Image.new("RGBA", (1, 1))).textbbox((0, 0), shaped, font=text_font)
    w = max(1, bbox[2] - bbox[0] + 24)
    h = max(1, bbox[3] - bbox[1] + 22)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((12 - bbox[0], 10 - bbox[1]), shaped, fill=fill, font=text_font)
    rotated = layer.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    image.alpha_composite(rotated, xy)


def draw_fold_and_scan_artifacts(image: Image.Image, *, heavy: bool = False) -> None:
    draw = ImageDraw.Draw(image, "RGBA")
    w, h = image.size
    mid = w // 2
    draw.rectangle((mid - 9, 0, mid + 13, h), fill=(185, 185, 178, 42 if not heavy else 58))
    draw.line((mid + 6, 8, mid + 6, h - 8), fill=(116, 116, 110, 76 if not heavy else 102), width=2)
    for x in (18, w - 22):
        draw.rectangle((x, 0, x + 18, h), fill=(95, 91, 85, 74))
    rng = np.random.default_rng(SEED + (31 if heavy else 17))
    arr = np.asarray(image.convert("RGB")).astype(np.int16)
    noise = rng.normal(0, 10 if heavy else 6, arr.shape).astype(np.int16)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    image.paste(Image.fromarray(arr).convert("RGBA"))


def date_text(iso_date: str | None, digit_system: str) -> str:
    if iso_date is None:
        return ""
    y, m, d = iso_date.split("-")
    ddmmyyyy = f"{d}/{m}/{y}"
    if digit_system == "arabic-indic":
        return ddmmyyyy.translate(WESTERN_TO_ARABIC_INDIC)
    if digit_system == "persian-indic":
        return ddmmyyyy.translate(WESTERN_TO_PERSIAN_INDIC)
    return ddmmyyyy


def base_doses(digit_system: str = "western") -> list[Dose]:
    rows = [
        ("birth_hepb", "Birth / عند الولادة", "HepB", "birth", "birth", "2024-01-01", "SYN-HB0"),
        ("birth_opv", "Birth / عند الولادة", "OPV", "0", "birth", "2024-01-01", "SYN-OPV0"),
        ("birth_bcg", "Birth / عند الولادة", "BCG", "birth", "birth", "2024-01-01", "SYN-BCG0"),
        ("two_month_dtp", "2 months / شهرين", "DTP", "1", "primary", "2024-03-01", "SYN-DTP1"),
        ("four_month_dtp", "4 months / ٤ شهور", "DTP", "2", "primary", "2024-05-01", "SYN-DTP2"),
        ("six_month_dtp", "6 months / ٦ شهور", "DTP", "3", "primary", "2024-07-01", "SYN-DTP3"),
        ("nine_month_opv", "9 months / ٩ شهور", "OPV", "booster", "booster", "2024-10-01", "SYN-OPVB"),
        ("twelve_month_mmr", "12 months / ١٢ شهر", "MMR", "1", "primary", "2025-01-01", "SYN-MMR1"),
        ("eighteen_month_dtp", "18 months / ١٨ شهر", "DTP", None, "booster", "2025-07-01", "SYN-DTPB"),
    ]
    return [
        Dose(
            row_id=row_id,
            visit=visit,
            antigen=antigen,
            dose_number=dose_number,
            dose_kind=dose_kind,
            date=iso_date,
            raw_date_text=date_text(iso_date, digit_system),
            lot_number=lot,
            confidence=0.96,
        )
        for row_id, visit, antigen, dose_number, dose_kind, iso_date, lot in rows
    ]


def who_doses() -> list[Dose]:
    rows = [
        ("who_bcg", "At birth", "BCG", "birth", "birth", "2024-02-02", "WHO-BCG-01"),
        ("who_opv0", "At birth", "OPV", "0", "birth", "2024-02-02", "WHO-OPV-00"),
        ("who_penta1", "6 weeks", "DTP", "1", "primary", "2024-03-15", "WHO-PEN-01"),
        ("who_penta2", "10 weeks", "DTP", "2", "primary", "2024-04-12", "WHO-PEN-02"),
        ("who_penta3", "14 weeks", "DTP", "3", "primary", "2024-05-10", "WHO-PEN-03"),
        ("who_mcv1", "9 months", "Measles", "1", "primary", "2024-11-02", "WHO-MCV-01"),
    ]
    return [
        Dose(
            row_id=row_id,
            visit=visit,
            antigen=antigen,
            dose_number=dose_number,
            dose_kind=dose_kind,
            date=iso_date,
            raw_date_text=date_text(iso_date, "western"),
            lot_number=lot,
            confidence=0.95,
        )
        for row_id, visit, antigen, dose_number, dose_kind, iso_date, lot in rows
    ]


def draw_table(
    image: Image.Image,
    rows: list[Dose],
    *,
    template: str,
    messy: bool = False,
    photocopy: bool = False,
    false_positive: bool = False,
) -> None:
    draw = ImageDraw.Draw(image)
    paper = (248, 247, 239) if not photocopy else (231, 231, 226)
    draw.rounded_rectangle((42, 34, WIDTH - 42, HEIGHT - 34), radius=24, fill=paper, outline=(94, 116, 130), width=3)

    if template == "egypt":
        draw.rectangle((42, 34, WIDTH - 42, 158), fill=(220, 235, 231), outline=(94, 116, 130), width=3)
        draw_text(draw, (74, 58), "Arab Republic of Egypt - Ministry of Health and Population", font_key="title")
        draw_text(draw, (WIDTH - 74, 111), "التطعيمات الإجبارية للأطفال - بطاقة اختبار اصطناعية", font_key="subtitle", anchor="ra")
    else:
        draw.rectangle((42, 34, WIDTH - 42, 158), fill=(249, 220, 102), outline=(112, 91, 37), width=3)
        draw_text(draw, (74, 59), "International Certificate of Vaccination", font_key="title", fill=(55, 47, 23))
        draw_text(draw, (74, 111), "WHO / UNICEF-style recreated mock template", font_key="subtitle", fill=(55, 47, 23))

    draw_text(draw, (75, 186), "SYNTHETIC FIXTURE - NOT A REAL CHILD RECORD", fill=(151, 47, 47), font_key="label")
    draw_text(draw, (75, 224), "Child: Test Child A    DOB: 01/01/2024    Fixture ID: SYN-CARD", font_key="body")
    draw_text(draw, (75, 259), "Clinic: Fictional Primary Care Unit    Governorate/Country: Mock", font_key="body")

    x0, y0 = 75, 310
    col_widths = [365, 285, 180, 270, 260]
    headers = ["Visit / زيارة", "Vaccine / التطعيم", "Dose", "Date / التاريخ", "Lot / Batch"]
    row_h = 62 if len(rows) <= 9 else 56
    table_w = sum(col_widths)

    draw.rectangle((x0, y0, x0 + table_w, y0 + row_h), fill=(70, 92, 104), outline=(34, 48, 54), width=2)
    cx = x0
    for w, h in zip(col_widths, headers):
        draw_text(draw, (cx + 14, y0 + 18), h, fill=(255, 255, 255), font_key="label")
        draw.line((cx, y0, cx, y0 + row_h * (len(rows) + 1)), fill=(103, 124, 134), width=2)
        cx += w
    draw.line((x0 + table_w, y0, x0 + table_w, y0 + row_h * (len(rows) + 1)), fill=(103, 124, 134), width=2)

    rng = random.Random(SEED + len(rows) + (7 if messy else 0))
    for idx, row in enumerate(rows):
        y = y0 + row_h * (idx + 1)
        fill = (255, 255, 250) if idx % 2 == 0 else (240, 246, 243)
        if photocopy:
            fill = (224, 224, 220) if idx % 2 == 0 else (216, 216, 212)
        draw.rectangle((x0, y, x0 + table_w, y + row_h), fill=fill, outline=(150, 164, 171), width=1)
        values = [
            row.visit,
            row.antigen,
            row.dose_number or "booster",
            row.raw_date_text or "",
            row.lot_number or "",
        ]
        cx = x0
        for cell_idx, (w, value) in enumerate(zip(col_widths, values)):
            tx = cx + 14
            ty = y + 17
            key = "hand" if messy and cell_idx in (3, 4) else "body"
            color = (31, 50, 61)
            if messy and cell_idx in (3, 4):
                tx += rng.randint(-5, 8)
                ty += rng.randint(-6, 7)
                color = rng.choice([(27, 58, 109), (68, 55, 74), (38, 72, 60)])
            draw_text(draw, (tx, ty), value, fill=color, font_key=key)
            cx += w

    if messy:
        for _ in range(45):
            x = rng.randint(65, WIDTH - 110)
            y = rng.randint(360, HEIGHT - 80)
            draw.line((x, y, x + rng.randint(12, 55), y + rng.randint(-9, 9)), fill=(105, 102, 96), width=1)
        stamp = Image.new("RGBA", image.size, (0, 0, 0, 0))
        stamp_draw = ImageDraw.Draw(stamp)
        stamp_draw.ellipse((1110, 690, 1460, 875), outline=(120, 37, 57, 130), width=7)
        stamp_draw.text((1168, 752), "MOCK CLINIC", font=FONTS["stamp"], fill=(120, 37, 57, 145))
        image.alpha_composite(stamp)

    if false_positive:
        y = HEIGHT - 132
        draw.rounded_rectangle((85, y, WIDTH - 95, y + 83), radius=8, fill=(255, 248, 219), outline=(190, 168, 82), width=2)
        draw_text(draw, (106, y + 17), "Notes / ملاحظات: phone 010/05/2024, form 12/05/2025-A, shelf 03-04-2024.", font_key="body")
        draw_text(draw, (106, y + 49), "These numbers are not administration dates and must not create vaccine rows.", font_key="small", fill=(112, 82, 34))


def add_noise(image: Image.Image, amount: float = 9.0) -> Image.Image:
    arr = np.asarray(image.convert("RGB")).astype(np.int16)
    rng = np.random.default_rng(SEED)
    noise = rng.normal(0, amount, arr.shape).astype(np.int16)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def skew_and_rotate(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    shear = -0.11
    xshift = abs(shear) * image.height
    new_width = image.width + int(round(xshift))
    transformed = image.transform(
        (new_width, image.height),
        Image.Transform.AFFINE,
        (1, shear, -xshift if shear > 0 else 0, 0, 1, 0),
        resample=Image.Resampling.BICUBIC,
        fillcolor=(238, 240, 236, 255),
    )
    return transformed.rotate(-8, expand=True, fillcolor=(238, 240, 236, 255)).convert("RGB")


def photocopy(image: Image.Image) -> Image.Image:
    gray = image.convert("L")
    gray = ImageEnhance.Contrast(gray).enhance(0.43)
    gray = ImageEnhance.Brightness(gray).enhance(1.18)
    gray = gray.filter(ImageFilter.GaussianBlur(radius=0.6))
    rgb = Image.merge("RGB", (gray, gray, gray))
    return add_noise(rgb, amount=6.5)


def handwritten_arabic_doses(*, heavy_notes: bool = False) -> list[Dose]:
    dates = [
        "2024-02-14",
        "2024-02-21",
        "2024-03-03",
        "2024-05-01",
        "2024-07-07",
        "2024-10-18",
        "2025-01-13",
        "2025-07-19",
        "2025-09-28",
    ]
    rows = base_doses("arabic-indic")
    rewritten: list[Dose] = []
    for idx, row in enumerate(rows):
        confidence = 0.74 if idx in {3, 4, 5, 8} else 0.82
        if heavy_notes and idx in {5, 6, 8}:
            confidence = 0.64
        rewritten.append(
            replace(
                row,
                date=dates[idx],
                raw_date_text=date_text(dates[idx], "arabic-indic"),
                confidence=confidence,
                reasoning_if_uncertain=(
                    "Dense handwritten Arabic-style entries cross table lines and photocopy noise."
                    if not heavy_notes
                    else "Heavy handwritten Arabic-style notes overlap date and provider cells."
                ),
            )
        )
    return rewritten


def english_handwritten_doses(*, low_contrast: bool = False) -> list[Dose]:
    rows = [
        ("eng_bcg", "Birth", "BCG", "birth", "birth", "2024-02-03", "EH-BCG"),
        ("eng_hepb", "Birth", "HepB", "birth", "birth", "2024-02-03", "EH-HB0"),
        ("eng_penta1", "6 weeks", "DTP", "1", "primary", "2024-03-16", "EH-PEN1"),
        ("eng_penta2", "10 weeks", "DTP", "2", "primary", "2024-04-13", "EH-PEN2"),
        ("eng_penta3", "14 weeks", "DTP", "3", "primary", "2024-05-11", "EH-PEN3"),
        ("eng_pcv1", "6 weeks", "PCV", "1", "primary", "2024-03-16", "EH-PCV1"),
        ("eng_rota1", "6 weeks", "Rotavirus", "1", "primary", "2024-03-16", "EH-ROTA1"),
        ("eng_mmr1", "9 months", "MMR", "1", "primary", "2024-11-04", "EH-MMR1"),
    ]
    return [
        Dose(
            row_id=row_id,
            visit=visit,
            antigen=antigen,
            dose_number=dose_number,
            dose_kind=dose_kind,
            date=iso_date,
            raw_date_text=date_text(iso_date, "western"),
            lot_number=lot,
            confidence=0.70 if low_contrast and idx in {3, 4, 7} else 0.84,
            reasoning_if_uncertain=(
                "English handwritten date cell with scan noise."
                if not low_contrast
                else "Low-contrast English handwriting; final digit may require HITL review."
            ),
        )
        for idx, (row_id, visit, antigen, dose_number, dose_kind, iso_date, lot) in enumerate(rows)
    ]


def draw_arabic_handwritten_scan(rows: list[Dose], *, heavy_notes: bool) -> Image.Image:
    w, h = 2100, 1450
    image = Image.new("RGBA", (w, h), (245, 245, 241, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((45, 25, w - 45, h - 35), fill=(250, 250, 247), outline=(125, 124, 118), width=3)

    # Left page: recreated printed sections and instructions.
    draw_text(draw, (195, 150), "الفحص السمعي للأطفال حديثي الولادة بالتزامن مع فحص الغدة الدرقية", font_key="label")
    for top in (215, 455):
        draw.rectangle((105, top, 940, top + 185), outline=(98, 98, 94), width=2)
        for x in (265, 430, 610, 775):
            draw.line((x, top, x, top + 185), fill=(120, 120, 116), width=2)
        for y in (top + 70, top + 125):
            draw.line((105, y, 940, y), fill=(120, 120, 116), width=2)
    draw_text(draw, (310, 640), '"إرشادات"', font_key="subtitle")
    instruction_lines = [
        "بادر بتطعيم طفلك ضد الأمراض المعدية المستهدفة في المواعيد المحددة.",
        "هذه بطاقة اختبار اصطناعية؛ لا تحتوي على أي سجل لطفل حقيقي.",
        "قد تؤدي الكتابة اليدوية والنسخ منخفض التباين إلى مراجعة بشرية.",
        "الأرقام الجانبية والملاحظات ليست صفوف تطعيم ما لم تقع داخل الجدول.",
        "راجع الطبيب عند وجود حساسية أو عرض طبي متزامن مع التطعيم.",
        "جميع الأسماء والأرقام والتواريخ في هذا النموذج خيالية.",
    ]
    for idx, line in enumerate(instruction_lines):
        draw_text(draw, (870, 705 + idx * 74), line, font_key="body", anchor="ra")

    # Right page: dense Egyptian-style immunization grid.
    x0, y0 = 1040, 185
    table_w, table_h = 885, 1095
    draw_text(draw, (1475, 122), "التطعيمات الإجبارية", font_key="title", anchor="mm")
    draw.rectangle((x0, y0, x0 + table_w, y0 + table_h), outline=(66, 66, 63), width=3)
    col_x = [x0, x0 + 120, x0 + 300, x0 + 475, x0 + 735, x0 + table_w]
    for x in col_x[1:-1]:
        draw.line((x, y0, x, y0 + table_h), fill=(86, 86, 83), width=2)
    header_h = 82
    draw.line((x0, y0 + header_h, x0 + table_w, y0 + header_h), fill=(86, 86, 83), width=2)
    headers = ["ملاحظات", "اسم القائم", "التاريخ", "التطعيم", "الزيارة"]
    for left, right, label in zip(col_x, col_x[1:], headers):
        draw_text(draw, ((left + right) // 2, y0 + 28), label, font_key="label", anchor="ma")

    row_h = (table_h - header_h) // len(rows)
    vaccine_print = {
        "HepB": "الالتهاب الكبدي B",
        "OPV": "شلل أطفال فموي",
        "BCG": "الدرن",
        "DTP": "الثلاثي البكتيري",
        "MMR": "الثلاثي الفيروسي",
    }
    visits = [
        "خلال ٢٤ ساعة من الميلاد",
        "خلال الأسبوع الأول",
        "خلال خمسة عشر يوماً",
        "عند إتمام شهرين",
        "عند إتمام ٤ شهور",
        "عند إتمام ٦ شهور",
        "عند إتمام ٩ شهور",
        "عند إتمام ١٢ شهراً",
        "عند إتمام ١٨ شهراً",
    ]
    providers = ["مها", "سلمى", "دعاء", "إيناس", "أمل", "ولاء", "هالة", "نورا", "سعاد"]
    rng = random.Random(SEED + (91 if heavy_notes else 73))
    for idx, row in enumerate(rows):
        y = y0 + header_h + idx * row_h
        draw.line((x0, y, x0 + table_w, y), fill=(103, 103, 99), width=2)
        draw_text(draw, (x0 + table_w - 20, y + 18), visits[idx], font_key="small", anchor="ra")
        vaccine_lines = [vaccine_print.get(row.antigen, row.antigen)]
        if row.antigen == "DTP" and idx in {3, 4, 5, 8}:
            vaccine_lines += ["شلل أطفال فموي", "الالتهاب الكبدي"]
        for line_idx, line in enumerate(vaccine_lines):
            draw_text(draw, (x0 + 715, y + 16 + line_idx * 27), f"❖ {line}", font_key="small", anchor="ra")
        date_angle = rng.uniform(-8, 6)
        draw_hand_text(
            image,
            (x0 + 330 + rng.randint(-10, 16), y + 20 + rng.randint(-8, 10)),
            row.raw_date_text or "",
            font_key="hand_ar",
            fill=(19, 29, 48, 236),
            angle=date_angle,
        )
        draw_hand_text(
            image,
            (x0 + 150 + rng.randint(-12, 12), y + 18 + rng.randint(-6, 12)),
            providers[idx],
            font_key="hand_ar",
            fill=(18, 34, 68, 220),
            angle=rng.uniform(-9, 5),
        )
        if idx in {1, 2, 5, 7, 8}:
            draw_hand_text(
                image,
                (x0 + 15 + rng.randint(-4, 8), y + 18),
                rng.choice(["الكامل", "راجع", "تم"]),
                font_key="hand_ar",
                fill=(18, 28, 46, 220),
                angle=rng.uniform(-18, 10),
            )
        if idx in {5, 6, 8} or (heavy_notes and idx in {2, 3, 7}):
            draw.line(
                (x0 + 430, y + row_h - 12, x0 + table_w + rng.randint(25, 95), y + rng.randint(15, row_h - 10)),
                fill=(29, 29, 35),
                width=3,
            )

    draw_text(draw, (x0 + table_w // 2, y0 + table_h + 34), "*** جميع هذه التطعيمات تعطى مجاناً ***", font_key="label", anchor="mm")
    side_notes = [
        ("تم إعطاء فيتامين أ", (1690, 42), -4),
        ("٢/١", (1755, 92), -6),
        ("بعد شهر", (1934, 600), 8),
        ("١٨/٩", (1932, 840), -7),
        ("موعد", (1970, 1120), -5),
    ]
    if heavy_notes:
        side_notes += [
            ("الجرعة كاملة", (1665, 690), -12),
            ("راجع ٩/٢٨", (1715, 930), 7),
            ("لا تؤخر", (1110, 980), -18),
        ]
    for text, xy, angle in side_notes:
        draw_hand_text(image, xy, text, font_key="hand_ar", fill=(27, 29, 35, 230), angle=angle)

    draw_fold_and_scan_artifacts(image, heavy=heavy_notes)
    output = image.convert("RGB")
    output = ImageEnhance.Contrast(output).enhance(0.72 if heavy_notes else 0.82)
    output = ImageEnhance.Brightness(output).enhance(1.06)
    return output.filter(ImageFilter.GaussianBlur(radius=0.25))


def draw_english_handwritten_card(rows: list[Dose], *, low_contrast: bool) -> Image.Image:
    w, h = 1650, 1120
    image = Image.new("RGBA", (w, h), (244, 246, 241, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((44, 38, w - 44, h - 38), fill=(252, 251, 244), outline=(87, 98, 104), width=3)
    draw_text(draw, (84, 76), "Child Immunization Record", font_key="title")
    draw_text(draw, (84, 130), "SYNTHETIC FIXTURE - handwritten English entries only", fill=(151, 47, 47), font_key="label")
    draw_text(draw, (84, 174), "Child: Test Child B    DOB: 03/02/2024    Clinic: Fictional Family Health Centre", font_key="body")

    x0, y0 = 85, 250
    col_widths = [210, 360, 150, 250, 245, 250]
    headers = ["Visit", "Vaccine", "Dose", "Date", "Lot", "Nurse / Notes"]
    row_h = 80
    table_w = sum(col_widths)
    draw.rectangle((x0, y0, x0 + table_w, y0 + row_h), fill=(62, 89, 101), outline=(40, 54, 60), width=2)
    cx = x0
    for width, header in zip(col_widths, headers):
        draw_text(draw, (cx + 14, y0 + 24), header, fill=(255, 255, 255), font_key="label")
        draw.line((cx, y0, cx, y0 + row_h * (len(rows) + 1)), fill=(92, 113, 121), width=2)
        cx += width
    draw.line((x0 + table_w, y0, x0 + table_w, y0 + row_h * (len(rows) + 1)), fill=(92, 113, 121), width=2)

    rng = random.Random(SEED + (203 if low_contrast else 177))
    nurses = ["Mona", "Claire", "S. Ali", "Mariam", "Nadia", "Jo", "M. Samir", "Lina"]
    for idx, row in enumerate(rows):
        y = y0 + row_h * (idx + 1)
        draw.rectangle((x0, y, x0 + table_w, y + row_h), fill=(252, 252, 248) if idx % 2 == 0 else (238, 244, 241), outline=(151, 163, 166), width=1)
        printed = [row.visit, row.antigen, row.dose_number or "booster"]
        cx = x0
        for value, width in zip(printed, col_widths[:3]):
            draw_text(draw, (cx + 14, y + 24), value, font_key="body")
            cx += width
        handwritten = [row.raw_date_text or "", row.lot_number or "", nurses[idx]]
        for value, width in zip(handwritten, col_widths[3:]):
            draw_hand_text(
                image,
                (cx + 14 + rng.randint(-5, 10), y + 19 + rng.randint(-6, 8)),
                value,
                font_key="hand_en",
                fill=rng.choice([(18, 37, 91, 230), (36, 52, 67, 226), (63, 42, 86, 220)]),
                angle=rng.uniform(-8, 7),
            )
            cx += width
        if idx in {2, 4, 7}:
            draw_hand_text(
                image,
                (x0 + table_w - 210, y + 46),
                rng.choice(["ok", "next visit", "seen"]),
                font_key="hand_en_small",
                fill=(20, 36, 86, 210),
                angle=rng.uniform(-12, 8),
            )

    draw_hand_text(image, (115, h - 125), "Parent copy - mock scan", font_key="hand_en", fill=(21, 34, 62, 210), angle=-4)
    draw.line((95, h - 95, 460, h - 124), fill=(25, 39, 80), width=3)
    if low_contrast:
        image = photocopy(image.convert("RGB")).convert("RGBA")
    else:
        output = add_noise(image.convert("RGB"), amount=3.5)
        return output
    return image.convert("RGB")


def make_arabic_handwritten_scan_card(
    fixture_id: str,
    filename: str,
    *,
    heavy_notes: bool = False,
) -> dict:
    rows = handwritten_arabic_doses(heavy_notes=heavy_notes)
    output = draw_arabic_handwritten_scan(rows, heavy_notes=heavy_notes)
    output.save(OUT_DIR / filename, quality=95)
    return handwritten_manifest(
        fixture_id,
        filename,
        rows,
        template="egypt",
        language="Arabic/English",
        digit_system="arabic-indic",
        warnings=[
            "Dense Arabic-style handwritten entries model a photocopied Egyptian card without copying real child data.",
            "Several handwritten notes cross row boundaries; extraction should preserve rows only from table cells.",
        ]
        + (["Heavy margin notes overlap selected date cells and should trigger HITL review."] if heavy_notes else []),
        visual_conditions={
            "handwriting_language": "Arabic",
            "dense_two_page_scan": True,
            "reference_style": "photocopied Egyptian handwritten card",
            "heavy_margin_notes": heavy_notes,
        },
    )


def make_english_handwritten_card(
    fixture_id: str,
    filename: str,
    *,
    low_contrast: bool = False,
) -> dict:
    rows = english_handwritten_doses(low_contrast=low_contrast)
    output = draw_english_handwritten_card(rows, low_contrast=low_contrast)
    output.save(OUT_DIR / filename, quality=95)
    return handwritten_manifest(
        fixture_id,
        filename,
        rows,
        template="who_unicef" if not low_contrast else "unknown_clinic_card",
        language="English",
        digit_system="western",
        warnings=[
            "English handwritten dates, lot numbers, and nurse initials should lower confidence versus printed cells.",
        ]
        + (["Low-contrast photocopy effect should route ambiguous handwritten cells to HITL."] if low_contrast else []),
        visual_conditions={
            "handwriting_language": "English",
            "english_handwritten_dates": True,
            "low_contrast": low_contrast,
        },
    )


def handwritten_manifest(
    fixture_id: str,
    filename: str,
    rows: list[Dose],
    *,
    template: str,
    language: str,
    digit_system: str,
    warnings: list[str],
    visual_conditions: dict,
) -> dict:
    return {
        "id": fixture_id,
        "filename": filename,
        "source_type": "synthetic_recreated_mock_card",
        "contains_real_child_record": False,
        "template": template,
        "language": language,
        "digit_system": digit_system,
        "visual_conditions": {
            "messy_handwriting": True,
            "rotated_or_skewed": False,
            "low_contrast": visual_conditions.get("low_contrast", False),
            "missing_date": False,
            "duplicate_same_visit_vaccines": False,
            "false_positive_date_like_numbers": False,
            **visual_conditions,
        },
        "expected_template_id": (
            "egypt_mohp_mandatory_childhood_immunization"
            if template == "egypt"
            else "unknown_vaccine_card"
        ),
        "expected_rows": [dose_to_manifest(row) for row in rows],
        "negative_controls": [],
        "expected_warnings": warnings,
    }


def make_card(
    fixture_id: str,
    filename: str,
    *,
    template: str = "egypt",
    digit_system: str = "western",
    messy: bool = False,
    rotated: bool = False,
    low_contrast: bool = False,
    missing_date: bool = False,
    duplicate_same_visit: bool = False,
    false_positive: bool = False,
) -> dict:
    rows = who_doses() if template == "who_unicef" else base_doses(digit_system)
    warnings: list[str] = []
    negative_controls: list[str] = []

    if missing_date:
        warnings.append("MMR row has a deliberately blank administration date.")
        rows = [
            replace(
                row,
                date=None,
                raw_date_text=None,
                confidence=0.72,
                reasoning_if_uncertain="Date cell is blank on the mock card.",
            )
            if row.row_id == "twelve_month_mmr"
            else row
            for row in rows
        ]

    if duplicate_same_visit:
        warnings.append("Two OPV dose-1 rows share the same visit date and must be preserved for duplicate handling tests.")
        duplicate = Dose(
            row_id="two_month_opv_duplicate",
            visit="2 months / شهرين",
            antigen="OPV",
            dose_number="1",
            dose_kind="primary",
            date="2024-03-01",
            raw_date_text=date_text("2024-03-01", digit_system),
            lot_number="SYN-OPV1-DUP",
            confidence=0.93,
            preserve_duplicate=True,
        )
        rows = rows[:4] + [duplicate] + rows[4:]

    if false_positive:
        negative_controls.extend(["010/05/2024", "12/05/2025-A", "03-04-2024"])
        warnings.append("Notes area contains date-like numbers that must not be emitted as administered doses.")

    if messy:
        warnings.append("Handwritten-style cells and mock stamp overlap reduce confidence.")
        rows = [
            replace(row, confidence=min(row.confidence, 0.86), reasoning_if_uncertain="Handwritten-style synthetic date cell.")
            if row.row_id in {"six_month_dtp", "nine_month_opv"}
            else row
            for row in rows
        ]

    if rotated:
        warnings.append("Card is skewed and rotated; extraction should set an orientation warning.")
        rows = [
            replace(row, confidence=min(row.confidence, 0.82), reasoning_if_uncertain="Mock card is skewed and rotated.")
            for row in rows
        ]

    if low_contrast:
        warnings.append("Low-contrast photocopy effect should lower confidence on visual extraction.")
        rows = [
            replace(row, confidence=min(row.confidence, 0.78), reasoning_if_uncertain="Low-contrast photocopy reduces date-cell legibility.")
            for row in rows
        ]

    image = Image.new("RGBA", (WIDTH, HEIGHT), (236, 238, 234, 255))
    draw_table(
        image,
        rows,
        template="who" if template == "who_unicef" else "egypt",
        messy=messy,
        photocopy=low_contrast,
        false_positive=false_positive,
    )
    output = image.convert("RGB")
    if messy:
        output = add_noise(output, amount=4.5)
    if rotated:
        output = skew_and_rotate(output)
    if low_contrast:
        output = photocopy(output)

    output.save(OUT_DIR / filename, quality=95)

    return {
        "id": fixture_id,
        "filename": filename,
        "source_type": "synthetic_recreated_mock_card",
        "contains_real_child_record": False,
        "template": template,
        "language": "Arabic/English" if template == "egypt" else "English",
        "digit_system": digit_system,
        "visual_conditions": {
            "messy_handwriting": messy,
            "rotated_or_skewed": rotated,
            "low_contrast": low_contrast,
            "missing_date": missing_date,
            "duplicate_same_visit_vaccines": duplicate_same_visit,
            "false_positive_date_like_numbers": false_positive,
        },
        "expected_template_id": (
            "egypt_mohp_mandatory_childhood_immunization"
            if template == "egypt"
            else "unknown_vaccine_card"
        ),
        "expected_rows": [dose_to_manifest(row) for row in rows],
        "negative_controls": negative_controls,
        "expected_warnings": warnings,
    }


def dose_to_manifest(dose: Dose) -> dict:
    return {
        "row_id": dose.row_id,
        "visit": dose.visit,
        "antigen": dose.antigen,
        "dose_number": dose.dose_number,
        "dose_kind": dose.dose_kind,
        "date": dose.date,
        "raw_date_text": dose.raw_date_text,
        "lot_number": dose.lot_number,
        "expected_confidence_ceiling": dose.confidence,
        "reasoning_if_uncertain": dose.reasoning_if_uncertain,
        "preserve_duplicate": dose.preserve_duplicate,
    }


def fixture_specs() -> Iterable[dict]:
    return [
        {
            "fixture_id": "clean_egyptian_card",
            "filename": "01-clean-egyptian-card.png",
        },
        {
            "fixture_id": "messy_handwritten_egyptian_card",
            "filename": "02-messy-handwritten-egyptian-card.png",
            "messy": True,
        },
        {
            "fixture_id": "rotated_skewed_egyptian_card",
            "filename": "03-rotated-skewed-egyptian-card.png",
            "rotated": True,
        },
        {
            "fixture_id": "low_contrast_photocopy",
            "filename": "04-low-contrast-photocopy.png",
            "low_contrast": True,
        },
        {
            "fixture_id": "arabic_indic_digit_variant",
            "filename": "05-arabic-indic-digit-variant.png",
            "digit_system": "arabic-indic",
        },
        {
            "fixture_id": "persian_indic_digit_variant",
            "filename": "06-persian-indic-digit-variant.png",
            "digit_system": "persian-indic",
        },
        {
            "fixture_id": "missing_date_card",
            "filename": "07-missing-date-card.png",
            "missing_date": True,
        },
        {
            "fixture_id": "duplicate_same_visit_vaccines",
            "filename": "08-duplicate-same-visit-vaccines.png",
            "duplicate_same_visit": True,
        },
        {
            "fixture_id": "false_positive_numbers_that_look_like_dates",
            "filename": "09-false-positive-numbers-that-look-like-dates.png",
            "false_positive": True,
        },
        {
            "fixture_id": "who_unicef_international_immunization_card",
            "filename": "10-who-unicef-international-immunization-card.png",
            "template": "who_unicef",
        },
        {
            "renderer": "arabic_handwritten_scan",
            "fixture_id": "arabic_handwritten_scan_like_reference",
            "filename": "11-arabic-handwritten-scan-like-reference.png",
        },
        {
            "renderer": "arabic_handwritten_scan",
            "fixture_id": "arabic_handwritten_heavy_margin_notes",
            "filename": "12-arabic-handwritten-heavy-margin-notes.png",
            "heavy_notes": True,
        },
        {
            "renderer": "english_handwritten",
            "fixture_id": "english_handwritten_international_card",
            "filename": "13-english-handwritten-international-card.png",
        },
        {
            "renderer": "english_handwritten",
            "fixture_id": "english_handwritten_low_contrast_card",
            "filename": "14-english-handwritten-low-contrast-card.png",
            "low_contrast": True,
        },
    ]


def main() -> None:
    random.seed(SEED)
    fixtures = []
    for raw_spec in fixture_specs():
        spec = dict(raw_spec)
        renderer = spec.pop("renderer", "standard")
        if renderer == "arabic_handwritten_scan":
            fixtures.append(make_arabic_handwritten_scan_card(**spec))
        elif renderer == "english_handwritten":
            fixtures.append(make_english_handwritten_card(**spec))
        else:
            fixtures.append(make_card(**spec))
    manifest = {
        "dataset_id": "hathor_synthetic_vaccination_cards_v1",
        "description": "Fourteen synthetic vaccination-card fixtures for OCR and extraction regression tests.",
        "privacy": {
            "synthetic_only": True,
            "real_child_records_allowed": False,
            "notes": "All child identifiers, lot numbers, dates, and clinic names are fictional.",
        },
        "generator": Path(__file__).name,
        "fixtures": fixtures,
    }
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(fixtures)} synthetic cards to {OUT_DIR}")


if __name__ == "__main__":
    main()
