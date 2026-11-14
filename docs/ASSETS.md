# Nieuwe TW-afbeeldingen

Gemaakt met de ingebouwde imagegen-tool op 14 november 2026. De originele
projectassets zijn bewaard. De nieuwe, projectgebonden bestanden zijn:

- `assets/v2/promoted.png`
- `assets/v2/demoted.png`
- `assets/v2/onestar.png`

Alle drie zijn 1672 × 941 pixels. De bot rendert ze op 1600 pixels breed. Titels,
spelersnamen, sterren en percentages worden door de bot toegevoegd, zodat die
niet afhankelijk zijn van tekst uit beeldgeneratie. `npm run preview:assets`
schrijft drie gebruiksklare voorbeelden naar `out/preview-*.png`.

## Gebruikte prompts

Gemeenschappelijk:

> Use case: stylized-concept. Asset type: production background illustration for a Clash of Clans clan Discord notification card, wide landscape 16:9 composition. Make a premium fantasy mobile-game notification background. [SUBJECT] Consistent art direction: deep midnight navy, sculpted 3D fantasy materials, subtle illuminated beveled perimeter frame, cinematic lighting, beautifully detailed but clean and readable at phone size. Main emblem occupies LEFT THIRD. RIGHT TWO THIRDS must be very dark, visually quiet, nearly flat navy negative space for runtime typography, no objects in that area. Top right and bottom right need clear space too. No text, no letters, no numbers, no logos, no watermark. This is one complete rectangular image, not a mockup or collage. Aim 1600x900 landscape.

Promotie — SUBJECT:

> A triumphant polished golden shield with three upward chevrons, small crown, radiant warm gold particles. Emerald accents. Celebration, strength and promotion.

Degradatie — SUBJECT:

> A battered steel shield with two downward crimson chevrons, a small tilted crown fallen at its foot, red embers. Humorous setback rather than grim or violent. Burgundy accents.

1-ster — SUBJECT:

> A large polished golden five-point star, flanked by two small dark unlit stars, a slightly dented shield behind it and a few sparks. Playful and mildly embarrassing mood. Amber accents.
