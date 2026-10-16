# T02 参考文献来源说明

本目录是 `../Multimodal Video Visualization.md` 的支撑材料：**12 篇原文 PDF**，全部实际下载并逐份校验（PDF 魔数、页数、首页标题与目标文献一致）。

## 获取方式与版本

| # | 文件 | 版本与获取方式 |
| --- | --- | --- |
| 01 | `01_Anchorage_TVCG2023.pdf` | 作者预印本（arXiv:2302.06806，页脚注明 "A preprint version of a publication at IEEE TVCG, 2023"），13 页 |
| 02 | `02_EmotionCues_TVCG2021.pdf` | 作者主页发布版（HKUST MMComVis 组页），14 页 |
| 03 | `03_EmoCo_TVCG2020.pdf` | 作者版（arXiv:1907.12918v2，页首注明 "This is the author's version ... published in IEEE TVCG"），11 页 |
| 04 | `04_VisualTED_TVCG2020.pdf` | 作者主页发布版（该 PDF 页眉仍是投稿模板 "VOL. XX, NO. XX, XX 2018"，卷期页信息来自正式发表记录），13 页 |
| 05 | `05_GestureLens_TVCG2022.pdf` | 作者主页发布版（页面标注 DOI 10.1109/TVCG.2022.3169175），14 页 |
| 06 | `06_SpeechMirror_TVCG2024.pdf` | 作者版（arXiv:2309.05091，页首注明作者版本），22 页 |
| 07 | `07_VideoPro_TVCG2024.pdf` | 预印本（arXiv:2308.00401v1），11 页 |
| 08 | `08_M2Lens_TVCG2022.pdf` | 作者版（页首注明 "This is the author's version"），11 页 |
| 09 | `09_DeHumor_TVCG2022.pdf` | 作者主页发布版，15 页 |
| 10 | `10_ViSeq_TVCG2020.pdf` | 作者主页发布版（HKUST VIS 组页），15 页 |
| 11 | `11_IntentVizor_CVPR2022.pdf` | CVPR 2022 开放获取版（CVF Open Access），10 页 |
| 12 | `12_VoiceCoach_CHI2020.pdf` | 作者主页发布版，12 页 |

> 版权说明：以上均为作者自行公开的预印本/作者版，或会议开放获取版本，仅用于个人学习与考核评审；正式引用请以 IEEE Xplore / ACM DL / CVF 的发表版为准。

## 与正文的对应

正文（`../Multimodal Video Visualization.md`）中的 `L####` 行号，指的是这些 PDF 的**文本抽取结果**中的行号。抽取产物（每份 PDF 一个 `.txt`）未随交付提交，但放在仓库之外供复核：

```
D:\suo\Documents\dsh\hci-exam-T02-text-verify\   ← 12 个 .txt，文件名与本目录 PDF 一一对应
```

工作区根目录的 `.text` 目录已在交付前移出 `hci-exam/`，避免把中间产物混进提交。抽取脚本见下节，可随时重新生成（`pypdf` 版本一致时行号与上述目录相同）。

## 复现抽取（可选）

在工作区根目录执行：

```powershell
python -m pip install pypdf
python - <<'PY'
import glob, os
from pypdf import PdfReader
out = r"T02\.text"; os.makedirs(out, exist_ok=True)
for p in sorted(glob.glob(r"T02\reference\*.pdf")):
    r = PdfReader(p)
    txt = "".join(f"\n\n<<<PAGE {i+1}>>>\n" + (pg.extract_text() or "") for i, pg in enumerate(r.pages))
    open(os.path.join(out, os.path.basename(p) + ".txt"), "w", encoding="utf-8").write(txt)
PY
```

注意：行号会随 `pypdf` 版本与抽取实现不同而略有漂移，因此行号只作为**定位线索**，结论以原文语义为准。
