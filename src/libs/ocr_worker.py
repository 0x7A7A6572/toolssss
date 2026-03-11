import sys
import json
from paddleocr import PaddleOCR
# 打包分发：使用 PyInstaller 将 Python 脚本打包成独立的 .exe (Windows) 或二进制文件，Electron 直接调用这个二进制文件

# 初始化一次，避免重复加载模型
ocr = PaddleOCR(use_angle_cls=True, lang="ch") 

if __name__ == "__main__":
    image_path = sys.argv[1]
    result = ocr.ocr(image_path, cls=True)
    # 格式化输出为 JSON
    print(json.dumps(result, ensure_ascii=False))