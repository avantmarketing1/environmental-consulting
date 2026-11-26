from .dxf_builder import build_ossm_dxf_bytes

__all__ = ["build_ossm_dxf_bytes"]

try:
    from .dxf_generator import generate_ossm_cad_plan

    __all__.append("generate_ossm_cad_plan")
except ImportError:
    # Browser Pyodide runtime loads pure-ezdxf dxf_builder.py without matplotlib/dxf_generator.py
    pass
