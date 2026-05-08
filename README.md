# Gestor de Talleres GEMB

Aplicación web interna para administrar talleres, participantes, pagos, asistencia, orden de llegada y reportes de la Fundación Social Gimnasio Emocional Mentes Brillantes.

## Estado actual

Este repositorio antes era un gestor de tareas. Ahora fue reemplazado por un gestor de talleres conservando el login con Google y Firebase.

## Funciones principales

- Inicio de sesión con Google mediante Firebase Auth.
- Panel general de talleres.
- Creación y administración de talleres.
- Registro manual de asistentes.
- Importación de asistentes desde Excel o CSV.
- Marcación de asistencia y orden de llegada.
- Control de pagos: pagado, pendiente y valor recibido.
- Exportación de reportes en PDF.
- Archivado/finalización de talleres.

## Tecnologías

- React
- Vite
- TypeScript
- Tailwind CSS
- Firebase Auth
- Firebase Firestore
- Vercel
- XLSX para importación de archivos
- jsPDF y jspdf-autotable para reportes PDF

## Estructura de datos

Para evitar conflictos con las reglas actuales de Firestore, los registros del gestor se guardan en la colección autorizada `tasks`, usando el campo `kind` para diferenciar los tipos de registro:

```txt
kind: "gemb_workshop"  -> taller
kind: "gemb_attendee"  -> asistente
```

Esto permite mantener la base Firebase existente sin crear colecciones nuevas que puedan fallar por permisos.

## Uso básico

1. Iniciar sesión con Google.
2. Crear un taller desde el panel lateral.
3. Entrar al taller.
4. Agregar asistentes manualmente o importar un archivo Excel/CSV.
5. Marcar asistencia cuando la persona llegue.
6. Marcar si pagó y registrar el valor.
7. Exportar el reporte PDF cuando sea necesario.

## Importación de Excel/CSV

La app detecta una columna de nombres si el archivo contiene encabezados como:

- `nombre`
- `name`
- `participante`
- `asistente`

Si no encuentra encabezado reconocido, usa la primera columna como nombre del asistente.

## Notas importantes

- El login actual se conserva.
- El proyecto se despliega en Vercel.
- Si se cambia el dominio principal, puede ser necesario agregar el nuevo dominio en Firebase Authentication > Settings > Authorized domains.
- Los componentes antiguos de tareas quedaron fuera del flujo principal y pueden limpiarse después.

## Recomendaciones pendientes

- Limpiar archivos antiguos del gestor de tareas que ya no se usan.
- Revisar reglas de Firestore para crear colecciones dedicadas `workshops` y `attendees` cuando se quiera separar mejor la base de datos.
- Añadir roles administrativos si varias personas van a usar la herramienta.
- Mejorar vista móvil para uso en ingreso/registro de asistentes durante eventos.
