"""
AI 配置业务逻辑层

封装 AiConfig 的 CRUD，每次变更自动持久化到本地文件。
"""

from app.configs.ai import AI_PROVIDER, AI_MODEL_TYPE, AiModel
from app.configs.main import get_config as get_app_config
from app.core.exceptions import NotFoundError, ValidationError


class AiModelService:
    """AI 模型管理服务 —— 配置持久化"""

    @staticmethod
    def _ai_config():
        """获取当前 AI 配置快捷方式"""
        return get_app_config().ai_config

    @staticmethod
    def get_use_model(type: AI_MODEL_TYPE = "llm") -> AiModel | None:
        """获取指定类型的可用模型（返回第一个匹配项）"""
        return next((m for m in get_app_config().ai_config.models if m.model_type == type), None)

    @staticmethod
    def _find_model(models: list[AiModel], model_id: str) -> AiModel | None:
        """在模型列表中按 ID 查找"""
        return next((m for m in models if m.model_id == model_id), None)

    @staticmethod
    def _generate_name(model: AiModel) -> str:
        """根据 provider + model_id 自动生成模型名称"""
        provider_info = AI_PROVIDER.get(model.provider)
        if provider_info and provider_info["title"]:
            return f"{provider_info['title']} · {model.model_id}"
        return model.model_id or model.name

    def list_models(self) -> list[AiModel]:
        return self._ai_config().models

    def get_model(self, model_id: str) -> AiModel:
        model = self._find_model(self._ai_config().models, model_id)
        if model is None:
            raise NotFoundError("模型不存在")
        return model

    def create_model(self, model: AiModel) -> AiModel:
        ai = self._ai_config()
        if self._find_model(ai.models, model.model_id) is not None:
            raise ValidationError(f"模型 {model.model_id} 已存在")
        if not model.name.strip():
            model.name = self._generate_name(model)
        ai.models.append(model)
        get_app_config().update_setting()
        return model

    def update_model(self, model_id: str, model: AiModel) -> AiModel:
        ai = self._ai_config()
        existing = self._find_model(ai.models, model_id)
        if existing is None:
            raise NotFoundError("模型不存在")
        # api_key 为空则保留原值
        if not model.api_key.strip():
            model.api_key = existing.api_key
        idx = next(i for i, m in enumerate(ai.models) if m.model_id == model_id)
        if not model.name.strip():
            model.name = self._generate_name(model)
        ai.models[idx] = model
        get_app_config().update_setting()
        return model

    def delete_model(self, model_id: str) -> None:
        ai = self._ai_config()
        if self._find_model(ai.models, model_id) is None:
            raise NotFoundError("模型不存在")
        ai.models = [m for m in ai.models if m.model_id != model_id]
        get_app_config().update_setting()


# 模块级单例
ai_model_service = AiModelService()


