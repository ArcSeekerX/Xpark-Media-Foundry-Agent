# SPDX-License-Identifier: GPL-3.0-only
import logging
import time
from pathlib import Path

import folder_paths
import comfy.patcher_extension
from comfy.ldm.minimax.model import MiniMaxH3Model
from comfy_extras.nodes_sparse_attention import install_override
from .cache import check_environment, load_model, load_gates, require, validate_model
from .streaming import SparseAttnPatch, make_block_patch

log = logging.getLogger(__name__)


class H3V2PreconvertedLoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "unet_name": (folder_paths.get_filename_list("diffusion_models"),),
            "cache_directory": ("STRING", {"default": "h3_preconverted/fc1_gate"}),
        }}

    RETURN_TYPES = ("MODEL", "H3_V2_CACHE")
    RETURN_NAMES = ("model", "cache")
    FUNCTION = "load"
    CATEGORY = "MiniMax H3/Streaming v2"
    DESCRIPTION = "Load preconverted FC1 W4A4 on CPU through native ComfyUI Dynamic VRAM. Convert offline first."

    def load(self, unet_name, cache_directory):
        check_environment()
        source = folder_paths.get_full_path_or_raise("diffusion_models", unet_name)
        directory = Path(cache_directory).expanduser()
        if not directory.is_absolute():
            directory = Path(folder_paths.models_dir) / directory
        directory = directory.resolve()
        model = load_model(source, directory)
        log.info("[H3 v2] %s", model.h3_v2_load_info)
        return model, str(directory)


class H3V2StreamingVSAPatch:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",), "cache": ("H3_V2_CACHE",),
            "keep_percent": ("FLOAT", {"default": 5.0, "min": 0.1, "max": 100.0, "step": 0.1}),
            "start_percent": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
            "end_percent": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
            "min_tokens": ("INT", {"default": 12288, "min": 0, "max": 1048576, "step": 64}),
            "verbose": ("BOOLEAN", {"default": True}),
        }}

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = "MiniMax H3/Streaming v2"
    DESCRIPTION = "Preconverted INT8 Gate, streamed one block at a time. Prefix tiles remain exact sinks."

    def patch(self, model, cache, keep_percent=5.0, start_percent=0.0, end_percent=1.0,
              min_tokens=12288, verbose=True):
        require(0 < keep_percent <= 100 and 0 <= start_percent <= end_percent <= 1, "Invalid sparse range")
        diffusion_model = model.get_model_object("diffusion_model")
        require(isinstance(diffusion_model, MiniMaxH3Model), "Requires native MiniMax H3")
        validate_model(model)
        begin = time.perf_counter()
        gates = load_gates(cache)
        log.info("[H3 v2] Gate 50/50 CPU load/pin %.3fs; runtime weight conversion 0s", time.perf_counter() - begin)
        sampling = model.get_model_object("model_sampling")
        patch = SparseAttnPatch(tau=1.3, topk_ratio=keep_percent / 100.0, vsa=True,
                               sigma_start=float(sampling.percent_to_sigma(start_percent)),
                               sigma_end=float(sampling.percent_to_sigma(end_percent)),
                               min_tokens=min_tokens, dense_blocks=set(),
                               sink_conditioning="exact_kv_and_rows", extra_tokens=0, verbose=verbose)

        def prepare(model_patcher, timestep, model_options):
            install_override(patch, model_options["transformer_options"])

        def cleanup(model_patcher):
            patch.reset()

        m = model.clone()
        install_override(patch, m.model_options["transformer_options"])
        m.add_callback_with_key(comfy.patcher_extension.CallbacksMP.ON_PREPARE_STATE, "h3_streaming_v2", prepare)
        m.add_callback_with_key(comfy.patcher_extension.CallbacksMP.ON_CLEANUP, "h3_streaming_v2", cleanup)
        for i, block in enumerate(diffusion_model.blocks):
            m.set_model_patch_replace(make_block_patch(block, i, patch, gates[i]), "dit", "double_block", i)
        log.info("[H3 v2] 50/50 block patches; FC2/QKV unchanged; keep %.1f%%", keep_percent)
        return (m,)


NODE_CLASS_MAPPINGS = {"H3V2PreconvertedLoader": H3V2PreconvertedLoader, "H3V2StreamingVSAPatch": H3V2StreamingVSAPatch}
NODE_DISPLAY_NAME_MAPPINGS = {"H3V2PreconvertedLoader": "H3 v2 Preconverted FC1 Loader",
                            "H3V2StreamingVSAPatch": "H3 v2 Streaming VSA (Preconverted Gate)"}
