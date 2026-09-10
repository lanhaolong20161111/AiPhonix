import asyncio, sys, os
sys.path.insert(0, r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py')
os.chdir(r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py')
import services.free_llm as free_llm
from config import load_config
free_llm.init(load_config().ark_chat)
from routes.ai_chinese import _detect_regions, MULTIMODAL_MODEL
from PIL import Image
svc = free_llm.get_service()
async def main():
    img = r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\data\ai_chinese_images\_user_debug.png'
    crops = await _detect_regions(img, False)
    print('新代码切割块数:', len(crops))
    for c in crops:
        print(f"--- 块{c['id']}: {c['title']}  y={c['bbox'][1]}~{c['bbox'][3]} ---")
        p = os.path.join(r'C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py','data','uploads',os.path.basename(c['image'].split('/')[-1]))
        if os.path.exists(p):
            reply = await asyncio.to_thread(svc.chat, '精确识别图片所有文字，逐行原样输出', image_paths=[p], max_tokens=800, model_override=MULTIMODAL_MODEL, disable_thinking=True)
            print('  内容:')
            for line in (reply or '(空)').split('\n'):
                print('   ', line)
asyncio.run(main())
