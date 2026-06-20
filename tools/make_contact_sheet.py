import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main():
    args = parse_args()
    paths = [Path(item) for item in args.images]
    if not paths:
        paths = sorted(Path(args.input_dir).glob("*.png"))
    if not paths:
        raise SystemExit("No images")

    first = Image.open(paths[0]).convert("RGB")
    cell_w, cell_h = first.size
    label_h = args.label_height
    cols = args.cols
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * (cell_h + label_h)), (248, 244, 236))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", args.font_size)
    except OSError:
        font = ImageFont.load_default()

    for index, path in enumerate(paths):
        image = Image.open(path).convert("RGB")
        if image.size != (cell_w, cell_h):
            image = image.resize((cell_w, cell_h))
        col = index % cols
        row = index // cols
        x = col * cell_w
        y = row * (cell_h + label_h)
        draw.text((x + 10, y + 8), path.stem, fill=(30, 30, 28), font=font)
        sheet.paste(image, (x, y + label_h))

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default="")
    parser.add_argument("--output", required=True)
    parser.add_argument("--cols", type=int, default=3)
    parser.add_argument("--label-height", type=int, default=40)
    parser.add_argument("--font-size", type=int, default=22)
    parser.add_argument("images", nargs="*")
    return parser.parse_args()


if __name__ == "__main__":
    main()
