use crate::compat::gpu_compat::user_gpu_matches_listing;
use crate::compat::types::{
    CompatibilityFactor, CompatibilityLevel, FactorStatus, HostSpecs, ParsedRequirements,
    RunCompatibilityReport,
};

pub fn build_report(
    host: HostSpecs,
    minimum: ParsedRequirements,
    recommended: ParsedRequirements,
) -> RunCompatibilityReport {
    let mut factors = Vec::new();

    let mem_min = factor_memory("memory_minimum", host.total_memory_mb, minimum.ram_mb);
    factors.push(mem_min.clone());

    let mem_rec = factor_memory_recommended(host.total_memory_mb, recommended.ram_mb);
    factors.push(mem_rec);

    factors.push(factor_gpu_minimum(&host, &minimum));
    factors.push(factor_gpu_recommended(&host, &recommended));

    factors.push(CompatibilityFactor {
        id: "directx".to_string(),
        status: FactorStatus::Unknown,
        summary: "DirectX en el equipo no se contrasta aquí con el requisito del juego.".to_string(),
    });

    let storage = factor_storage(minimum.storage_gb);
    factors.push(storage);

    let overall = resolve_overall(&mem_min.status, &factors);

    RunCompatibilityReport {
        overall,
        host,
        minimum,
        recommended,
        factors,
    }
}

fn factor_memory(id: &str, host_mb: u64, required_mb: Option<u64>) -> CompatibilityFactor {
    match required_mb {
        None => CompatibilityFactor {
            id: id.to_string(),
            status: FactorStatus::Unknown,
            summary: "No se pudo leer la RAM mínima del texto de requisitos.".to_string(),
        },
        Some(req) if host_mb >= req => CompatibilityFactor {
            id: id.to_string(),
            status: FactorStatus::Pass,
            summary: format!(
                "RAM del sistema ({host_mb} MB) alcanza o supera el mínimo indicado ({req} MB)."
            ),
        },
        Some(req) => CompatibilityFactor {
            id: id.to_string(),
            status: FactorStatus::Fail,
            summary: format!(
                "RAM del sistema ({host_mb} MB) está por debajo del mínimo indicado ({req} MB)."
            ),
        },
    }
}

fn factor_memory_recommended(host_mb: u64, rec_mb: Option<u64>) -> CompatibilityFactor {
    match rec_mb {
        None => CompatibilityFactor {
            id: "memory_recommended".to_string(),
            status: FactorStatus::Unknown,
            summary: "No hay RAM recomendada parseable en el texto.".to_string(),
        },
        Some(req) if host_mb >= req => CompatibilityFactor {
            id: "memory_recommended".to_string(),
            status: FactorStatus::Pass,
            summary: format!(
                "RAM ({host_mb} MB) cumple o supera la recomendada ({req} MB)."
            ),
        },
        Some(req) => CompatibilityFactor {
            id: "memory_recommended".to_string(),
            status: FactorStatus::Unknown,
            summary: format!(
                "RAM ({host_mb} MB) por debajo de la recomendada ({req} MB); el mínimo puede bastar."
            ),
        },
    }
}

fn factor_gpu_minimum(host: &HostSpecs, req: &ParsedRequirements) -> CompatibilityFactor {
    let user = host.gpu_name.as_deref().unwrap_or("").trim();
    let Some(txt) = req.gpu_text.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
        return CompatibilityFactor {
            id: "gpu_minimum".to_string(),
            status: FactorStatus::Unknown,
            summary: "No se encontró la línea Gráficos/Graphics en el texto de requisitos mínimos.".to_string(),
        };
    };
    if user.is_empty() {
        return CompatibilityFactor {
            id: "gpu_minimum".to_string(),
            status: FactorStatus::Unknown,
            summary: "No se detectó la GPU en este equipo; no se puede comparar con la ficha.".to_string(),
        };
    }
    if user_gpu_matches_listing(user, txt) {
        return CompatibilityFactor {
            id: "gpu_minimum".to_string(),
            status: FactorStatus::Pass,
            summary: format!(
                "Tu GPU coincide con una de las opciones mínimas listadas en la tienda ({user})."
            ),
        };
    }
    CompatibilityFactor {
        id: "gpu_minimum".to_string(),
        status: FactorStatus::Unknown,
        summary: format!(
            "Tu GPU ({user}) no coincide textualmente con las opciones mínimas de la tienda; puede ser más potente o más débil; no se ordena por rendimiento."
        ),
    }
}

fn factor_gpu_recommended(host: &HostSpecs, req: &ParsedRequirements) -> CompatibilityFactor {
    let user = host.gpu_name.as_deref().unwrap_or("").trim();
    let Some(txt) = req.gpu_text.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
        return CompatibilityFactor {
            id: "gpu_recommended".to_string(),
            status: FactorStatus::Unknown,
            summary: "No hay línea Gráficos/Graphics en los requisitos recomendados.".to_string(),
        };
    };
    if user.is_empty() {
        return CompatibilityFactor {
            id: "gpu_recommended".to_string(),
            status: FactorStatus::Unknown,
            summary: "Sin GPU detectada; no se compara con lo recomendado.".to_string(),
        };
    }
    if user_gpu_matches_listing(user, txt) {
        return CompatibilityFactor {
            id: "gpu_recommended".to_string(),
            status: FactorStatus::Pass,
            summary: format!(
                "Tu GPU coincide con una de las opciones recomendadas en la tienda ({user})."
            ),
        };
    }
    CompatibilityFactor {
        id: "gpu_recommended".to_string(),
        status: FactorStatus::Unknown,
        summary: format!(
            "Tu GPU ({user}) no aparece tal cual entre las recomendadas; el rendimiento puede variar."
        ),
    }
}

fn factor_storage(required_gb: Option<u64>) -> CompatibilityFactor {
    match required_gb {
        None => CompatibilityFactor {
            id: "storage".to_string(),
            status: FactorStatus::Unknown,
            summary: "Espacio en disco del requisito no parseado o no comparado con discos locales.".to_string(),
        },
        Some(_gb) => CompatibilityFactor {
            id: "storage".to_string(),
            status: FactorStatus::Unknown,
            summary: "El espacio libre por unidad no se evalúa aún; comprueba el disco de instalación.".to_string(),
        },
    }
}

fn resolve_overall(
    memory_minimum: &FactorStatus,
    factors: &[CompatibilityFactor],
) -> CompatibilityLevel {
    if matches!(memory_minimum, FactorStatus::Fail) {
        return CompatibilityLevel::Unlikely;
    }

    let has_fail = factors.iter().any(|f| matches!(f.status, FactorStatus::Fail));
    if has_fail {
        return CompatibilityLevel::Unlikely;
    }

    let unknown_required = matches!(memory_minimum, FactorStatus::Unknown);
    if unknown_required {
        return CompatibilityLevel::Uncertain;
    }

    CompatibilityLevel::Likely
}
