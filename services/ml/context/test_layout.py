"""Checks the layout logic without loading any OCR model.
Run from services/ml:  python -m context.test_layout
"""

from context.ocr import layout_text


def box(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def test_indentation():
    items = [
        (box(100, 100, 190, 120), "def f(x):", "0.9"),
        (box(140, 130, 220, 150), "return x", "0.9"),
    ]
    assert layout_text(items) == "def f(x):\n    return x"


def test_line_numbers_are_dropped():
    items = [
        (box(20, 100, 30, 120), "1", "0.9"),
        (box(100, 100, 190, 120), "def f(x):", "0.9"),
        (box(20, 130, 30, 150), "2", "0.9"),
        (box(140, 130, 220, 150), "return x", "0.9"),
    ]
    assert layout_text(items) == "def f(x):\n    return x"


def test_blank_line_between_far_rows():
    items = [
        (box(100, 100, 190, 120), "def f(x):", "0.9"),
        (box(140, 130, 220, 150), "return x", "0.9"),
        (box(100, 190, 180, 210), "print(1)", "0.9"),
    ]
    assert layout_text(items) == "def f(x):\n    return x\n\nprint(1)"


def test_order_does_not_depend_on_input_order():
    items = [
        (box(140, 130, 220, 150), "return x", "0.9"),
        (box(100, 100, 190, 120), "def f(x):", "0.9"),
    ]
    assert layout_text(items) == "def f(x):\n    return x"


def test_misread_line_numbers_are_dropped():
    items = [
        (box(20, 100, 30, 120), "1", "0.9"),
        (box(100, 100, 190, 120), "def f(x):", "0.9"),
        (box(20, 130, 30, 150), "W", "0.9"),
        (box(140, 130, 220, 150), "return x", "0.9"),
        (box(20, 160, 30, 180), "3", "0.9"),
        (box(100, 160, 180, 180), "print(1)", "0.9"),
    ]
    assert layout_text(items) == "def f(x):\n    return x\nprint(1)"


def test_indents_snap_to_four():
    # pixel offsets are a little off from exact multiples of 4 characters (10 px each)
    items = [
        (box(100, 100, 200, 120), "def run():", "0.9"),
        (box(138, 130, 218, 150), "while 1:", "0.9"),
        (box(178, 160, 228, 180), "if x:", "0.9"),
        (box(217, 190, 267, 210), "break", "0.9"),
    ]
    assert (
        layout_text(items)
        == "def run():\n    while 1:\n        if x:\n            break"
    )


def test_empty():
    assert layout_text([]) == ""


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
