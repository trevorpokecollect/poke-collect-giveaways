# Renders the countdown GIF's glyph masks (2x scale) into a TS module.
import base64, sys
from PIL import Image, ImageDraw, ImageFont
F="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
def atlas(chars, size, tabular=False):
    font=ImageFont.truetype(F,size)
    asc,desc=font.getmetrics(); h=asc+desc
    out={}
    widths={c:int(round(font.getlength(c))) for c in chars}
    tw=max(widths.values()) if tabular else None
    for c in chars:
        w=tw or widths[c]
        im=Image.new("L",(w+2,h),0); d=ImageDraw.Draw(im)
        d.text(((w-widths[c])/2+1,0),c,font=font,fill=255)
        out[c]=(im.width,base64.b64encode(im.tobytes()).decode())
    return h,out
dh,digits=atlas("0123456789",48,True)
lh,letters=atlas("HOURSMINECDAWGTNO",21)
def emit(name,h,a):
    s=f"export const {name} = {{\n  height: {h},\n  glyphs: {{\n"
    for c,(w,b) in a.items(): s+=f'    "{c}": [{w}, "{b}"],\n'
    return s+"  } as Record<string, [number, string]>,\n};\n"
src="// Generated glyph masks for the countdown GIF (Arial Bold, 2x scale): [width, base64 8-bit\n// coverage, row-major, `height` rows]. Regenerate with `python3 scripts/countdown-glyphs.py app/lib/countdown-glyphs.ts`.\n\n"
src+=emit("DIGITS",dh,digits)+"\n"+emit("LETTERS",lh,letters)
open(sys.argv[1],"w").write(src)
