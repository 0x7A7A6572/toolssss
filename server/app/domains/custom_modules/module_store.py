"""
模块持久化存储

存储路径：
  {userDataPath}/custom-modules/modules/{id}.json  — 模块配置
  {userDataPath}/custom-modules/cache/{id}.json    — 模块缓存

参考 agents/conversation_store.py 的 JSON 文件读写模式。
"""

import json
import time
import uuid
from pathlib import Path
from typing import Optional

from app.models.custom_modules import CustomModuleCache, CustomModuleConfig


def generate_id(prefix: str) -> str:
    """生成唯一 ID"""
    return f"{prefix}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"


def _now_ms() -> float:
    return time.time() * 1000


class ModuleStore:
    """模块持久化存储"""

    def __init__(self, base_dir: str) -> None:
        self._dir = Path(base_dir) / "custom-modules" / "modules"
        self._cache_dir = Path(base_dir) / "custom-modules" / "cache"
        self._ensure_dirs()

    def _ensure_dirs(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    # =========================================================================
    # 模块配置 CRUD
    # =========================================================================

    def list_all(self) -> list[CustomModuleConfig]:
        """列出所有模块，按创建时间升序"""
        self._ensure_dirs()
        modules = []
        for f in sorted(self._dir.glob("*.json")):
            mod = self.load(f.stem)
            if mod:
                modules.append(mod)
        return modules

    def load(self, module_id: str) -> Optional[CustomModuleConfig]:
        """加载单个模块配置"""
        try:
            raw = self._file_path(module_id).read_text(encoding="utf-8")
            data = json.loads(raw)
            if not isinstance(data, dict):
                return None
            return CustomModuleConfig.model_validate(data)
        except (FileNotFoundError, json.JSONDecodeError, ValueError):
            return None

    def save(self, module: CustomModuleConfig) -> None:
        """保存模块配置"""
        self._ensure_dirs()
        data = module.model_dump()
        self._file_path(module.id).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def delete(self, module_id: str) -> None:
        """删除模块配置"""
        try:
            self._file_path(module_id).unlink()
        except FileNotFoundError:
            pass
        self.delete_cache(module_id)

    def _file_path(self, module_id: str) -> Path:
        return self._dir / f"{module_id}.json"

    # =========================================================================
    # 缓存 CRUD
    # =========================================================================

    def load_cache(self, module_id: str) -> Optional[CustomModuleCache]:
        """加载模块缓存"""
        try:
            raw = self._cache_file_path(module_id).read_text(encoding="utf-8")
            data = json.loads(raw)
            if not isinstance(data, dict):
                return None
            return CustomModuleCache.model_validate(data)
        except (FileNotFoundError, json.JSONDecodeError, ValueError):
            return None

    def save_cache(self, module_id: str, cache: CustomModuleCache) -> None:
        """保存模块缓存"""
        self._ensure_dirs()
        data = cache.model_dump()
        self._cache_file_path(module_id).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def delete_cache(self, module_id: str) -> None:
        """删除模块缓存"""
        try:
            self._cache_file_path(module_id).unlink()
        except FileNotFoundError:
            pass

    def _cache_file_path(self, module_id: str) -> Path:
        return self._cache_dir / f"{module_id}.json"
