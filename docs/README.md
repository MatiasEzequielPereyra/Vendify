# Documentación de ingeniería de Vendify

Este índice reúne las guías existentes para encontrar rápidamente contratos, pruebas y procedimientos antes de cambiar el proyecto.

## Dónde empezar

| Necesidad | Documento |
| --- | --- |
| Descripción general y primer inicio | [README del repositorio](../README.md) |
| Convenciones para contribuir y validar cambios | [CONTRIBUTING](../CONTRIBUTING.md) |
| Arquitectura y límites de responsabilidad | [ARCHITECTURE](ARCHITECTURE.md) |
| Ramas y contenido requerido de los PR | [BRANCHING](BRANCHING.md) |
| Proceso de release, migraciones y rollback | [RELEASE_PROCESS](RELEASE_PROCESS.md) |
| Verificaciones de la base de ingeniería | [FOUNDATION_QA](FOUNDATION_QA.md) |
| Evolución incremental a TypeScript | [TYPESCRIPT_MIGRATION](TYPESCRIPT_MIGRATION.md) |
| Configuración histórica del repositorio | [GITHUB_BOOTSTRAP](GITHUB_BOOTSTRAP.md) |
| Decisiones de arquitectura | [ADR](adr/) |
| Auditorías y matrices históricas | [Auditorías](audit/) |

## Antes de enviar un cambio

1. Confirmar la rama base, el commit de partida y el alcance del cambio. `main` es la referencia del release estable; el trabajo de modernización puede vivir en ramas de integración distintas.
2. Consultar [CONTRIBUTING](../CONTRIBUTING.md) y [BRANCHING](BRANCHING.md); no escribir directamente en ramas protegidas.
3. Ejecutar `npm run ci` y registrar el resultado real. Para cambios de base de datos, seguir además el preflight, la verificación en staging y las notas de reversión de [RELEASE_PROCESS](RELEASE_PROCESS.md).
4. Describir en el PR qué cambió, el riesgo de regresión, las pruebas realizadas, las migraciones (si existen) y cómo revertirlo.

## Cómo interpretar las evidencias

Los documentos de [FOUNDATION_QA](FOUNDATION_QA.md) y [Auditorías](audit/) describen comprobaciones realizadas para momentos o versiones concretas; no certifican automáticamente el estado del HEAD actual. Antes de declarar una versión apta para release, comprobar los checks del commit correspondiente y el comportamiento en el entorno correcto.

Un build exitoso, un deployment `READY` y una prueba funcional autenticada son evidencias diferentes. No tratar una como sustituto de las otras. Nunca incluir secretos o credenciales privadas en commits, documentación ni registros de prueba.
