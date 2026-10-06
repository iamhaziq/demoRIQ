"""Model versions: promotion rules, artifacts on the Modal Volume, and model_versions rows."""

from __future__ import annotations

import json
import pickle
import platform
from importlib import metadata
from pathlib import Path
from typing import Any

MARGIN = 0.05  # a challenger must be at least 5% better (relative WAPE)
EPS = 1e-9  # so "exactly 5% better" is not lost to float rounding
LGBM = "lightgbm"
FALLBACK = "window_avg_28"  # used when nothing could be backtested


def choose_candidate(scores: dict[str, float | None]) -> tuple[str, float | None, float | None]:
    """Returns (model_type, wape, best_baseline_wape). LightGBM must beat the best baseline by MARGIN."""
    base = {k: v for k, v in scores.items() if k != LGBM and v is not None}
    if not base:
        return FALLBACK, None, None
    best = min(base, key=base.get)
    lgbm = scores.get(LGBM)
    if lgbm is not None and lgbm <= (1 - MARGIN) * base[best] + EPS:
        return LGBM, lgbm, base[best]
    return best, base[best], base[best]


def should_promote(candidate_wape: float | None, champion: dict | None) -> bool:
    """Promote when there is no champion, or the candidate beats its WAPE by MARGIN."""
    if champion is None:
        return True
    if candidate_wape is None:
        return False
    if champion.get("wape") is None:
        return True
    return candidate_wape <= (1 - MARGIN) * float(champion["wape"]) + EPS


# ---- artifacts --------------------------------------------------------------------------------

def library_versions() -> dict[str, str]:
    libs = ("lightgbm", "statsforecast", "pandas", "numpy", "scikit-learn")
    out = {"python": platform.python_version()}
    for lib in libs:
        try:
            out[lib] = metadata.version(lib)
        except metadata.PackageNotFoundError:
            pass
    return out


def version_dir(models_dir: str | Path, shop_id: str, version: int) -> Path:
    return Path(models_dir) / str(shop_id) / f"v{version}"


def save_artifacts(models_dir: str | Path, shop_id: str, version: int, model: Any, meta: dict) -> Path:
    d = version_dir(models_dir, shop_id, version)
    d.mkdir(parents=True, exist_ok=True)
    with open(d / "model.pkl", "wb") as f:
        pickle.dump(model, f)
    (d / "meta.json").write_text(json.dumps({**meta, "libraries": library_versions()}, indent=2, default=str))
    return d


def load_artifacts(path: str | Path) -> tuple[Any, dict]:
    d = Path(path)
    with open(d / "model.pkl", "rb") as f:
        model = pickle.load(f)
    return model, json.loads((d / "meta.json").read_text())


# ---- model_versions rows (conn: psycopg connection as ml_worker) ---------------------------

def current_champion(conn, shop_id: str) -> dict | None:
    row = conn.execute(
        "select id, version, model_type, wape, volume_path from public.model_versions"
        " where shop_id = %s and status = 'champion'",
        (shop_id,),
    ).fetchone()
    if row is None:
        return None
    return dict(zip(("id", "version", "model_type", "wape", "volume_path"), row))


def next_version(conn, shop_id: str) -> int:
    (n,) = conn.execute(
        "select coalesce(max(version), 0) + 1 from public.model_versions where shop_id = %s", (shop_id,)
    ).fetchone()
    return int(n)


def insert_version(conn, shop_id: str, version: int, model_type: str, volume_path: str,
                   snapshot_path: str | None, wape: float | None, baseline_wape: float | None,
                   metrics: dict) -> str:
    (vid,) = conn.execute(
        "insert into public.model_versions"
        " (shop_id, version, model_type, volume_path, data_snapshot_path, wape, baseline_wape, metrics_json)"
        " values (%s, %s, %s, %s, %s, %s, %s, %s) returning id",
        (shop_id, version, model_type, volume_path, snapshot_path, wape, baseline_wape, json.dumps(metrics)),
    ).fetchone()
    return str(vid)


def promote(conn, shop_id: str, version_id: str) -> None:
    """Retire the current champion and promote version_id, in one transaction."""
    with conn.transaction():
        conn.execute(
            "update public.model_versions set status = 'retired'"
            " where shop_id = %s and status = 'champion' and id <> %s",
            (shop_id, version_id),
        )
        conn.execute(
            "update public.model_versions set status = 'champion' where shop_id = %s and id = %s",
            (shop_id, version_id),
        )


def rollback(conn, shop_id: str, version: int) -> None:
    """Make an earlier version the champion again."""
    row = conn.execute(
        "select id from public.model_versions where shop_id = %s and version = %s", (shop_id, version)
    ).fetchone()
    if row is None:
        raise ValueError(f"shop {shop_id} has no version {version}")
    promote(conn, shop_id, str(row[0]))
