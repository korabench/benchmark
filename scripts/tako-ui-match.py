#!/usr/bin/env python3

import json
import sys

import numpy as np
from PIL import Image


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


if len(sys.argv) != 6:
    fail(
        "Usage: tako-ui-match.py <screenshot> <template> <x> <min-y> <max-y>"
    )

screenshot_path, template_path = sys.argv[1:3]
x, min_y, max_y = map(int, sys.argv[3:6])
screenshot = np.asarray(Image.open(screenshot_path).convert("L"), dtype=np.float32)
template = np.asarray(Image.open(template_path).convert("L"), dtype=np.float32)
height, width = template.shape

if x < 0 or x + width > screenshot.shape[1]:
    fail("Template x range is outside the screenshot.")

start_y = max(0, min_y)
end_y = min(max_y, screenshot.shape[0] - height)
if end_y < start_y:
    fail("Template y range is outside the screenshot.")

scores = np.fromiter(
    (
        0.85
        * np.mean(
            np.abs(
                screenshot[y : y + height, x : x + width][template < 245]
                - template[template < 245]
            )
        )
        / 255.0
        + 0.15
        * np.mean(
            np.abs(
                screenshot[y : y + height, x : x + width][template >= 245]
                - template[template >= 245]
            )
        )
        / 255.0
        for y in range(start_y, end_y + 1)
    ),
    dtype=np.float64,
    count=end_y - start_y + 1,
)
best_offset = int(np.argmin(scores))
print(
    json.dumps(
        {
            "x": x,
            "y": start_y + best_offset,
            "score": float(scores[best_offset]),
        }
    )
)
