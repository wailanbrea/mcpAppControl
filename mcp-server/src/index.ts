import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { readFileSync } from "node:fs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000/api/v1";
const BACKEND_TOKEN = (() => {
    if (process.env.BACKEND_TOKEN) return process.env.BACKEND_TOKEN.trim();
    if (!process.env.BACKEND_TOKEN_FILE) return "";
    try {
        return readFileSync(process.env.BACKEND_TOKEN_FILE, "utf8").trim();
    } catch (error) {
        console.error(`No se pudo leer BACKEND_TOKEN_FILE: ${(error as Error).message}`);
        return "";
    }
})();

const api = axios.create({
    baseURL: BACKEND_URL,
    headers: BACKEND_TOKEN ? { Authorization: `Bearer ${BACKEND_TOKEN}` } : {},
    timeout: 30000,
});

// ============================================================
// MCP Tool Definitions
// ============================================================

const TOOLS = [
    // Device tools
    {
        name: "devices_list",
        description: "Lista todos los dispositivos registrados en la flota",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "devices_get_status",
        description: "Obtiene el estado actual de un dispositivo (por ID o número de serie), con sus últimos logs",
        inputSchema: {
            type: "object",
            properties: {
                device_id: { type: "string", description: "ID o número de serie del dispositivo" },
            },
            required: ["device_id"],
        },
    },
    {
        name: "devices_register",
        description: "Registra un nuevo dispositivo en la flota",
        inputSchema: {
            type: "object",
            properties: {
                serial_number: { type: "string" },
                name: { type: "string" },
                model: { type: "string" },
                android_version: { type: "string" },
            },
            required: ["serial_number"],
        },
    },
    {
        name: "devices_stats",
        description: "Estadísticas de salud de la flota (online/busy/offline)",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "devices_stabilize",
        description: "Estabiliza dispositivos ADB: despierta la pantalla, configura tiempo de espera, animaciones y opcionalmente hora/zona; verifica cada cambio",
        inputSchema: {
            type: "object",
            properties: {
                device_ids: { type: "array", items: { type: "number" }, minItems: 1 },
                keep_awake: { type: "boolean" },
                screen_timeout_minutes: { type: "number", minimum: 1, maximum: 120 },
                animation_scale: { type: "number", enum: [0, 0.5, 1] },
                sync_time: { type: "boolean" },
                timezone: { type: "string", description: "Zona IANA, por ejemplo America/Chicago" },
            },
            required: ["device_ids"],
        },
    },
    {
        name: "devices_network_status",
        description: "Diagnostica proxy, IP local, ruta, fecha, zona horaria y ajustes de estabilidad en varios dispositivos",
        inputSchema: {
            type: "object",
            properties: {
                device_ids: { type: "array", items: { type: "number" }, minItems: 1 },
            },
            required: ["device_ids"],
        },
    },
    {
        name: "devices_clear_proxy",
        description: "Elimina y verifica todas las claves del proxy global en varios dispositivos",
        inputSchema: {
            type: "object",
            properties: {
                device_ids: { type: "array", items: { type: "number" }, minItems: 1 },
            },
            required: ["device_ids"],
        },
    },

    // Proxy tools
    {
        name: "proxies_list",
        description: "Lista el pool de proxies, capacidad y asignaciones sin revelar contraseñas",
        inputSchema: {
            type: "object",
            properties: {
                status: { type: "string", enum: ["active", "disabled", "error"] },
                country: { type: "string" },
            },
        },
    },
    {
        name: "proxies_create",
        description: "Agrega un proxy HTTP al pool cifrado",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string" },
                host: { type: "string" },
                port: { type: "number" },
                username: { type: "string" },
                password: { type: "string" },
                country: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                max_devices: { type: "number", minimum: 1 },
            },
            required: ["host", "port"],
        },
    },
    {
        name: "proxies_import",
        description: "Importa varios proxies HTTP al pool en una operación",
        inputSchema: {
            type: "object",
            properties: {
                proxies: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            host: { type: "string" },
                            port: { type: "number" },
                            username: { type: "string" },
                            password: { type: "string" },
                            country: { type: "string" },
                            tags: { type: "array", items: { type: "string" } },
                            max_devices: { type: "number", minimum: 1 },
                        },
                        required: ["host", "port"],
                    },
                },
            },
            required: ["proxies"],
        },
    },
    {
        name: "proxies_distribute",
        description: "Distribuye proxies disponibles entre dispositivos online, respetando capacidad y filtros",
        inputSchema: {
            type: "object",
            properties: {
                device_ids: { type: "array", items: { type: "number" } },
                group_id: { type: "number" },
                strategy: { type: "string", enum: ["round_robin", "random"] },
                country: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
            },
        },
    },
    {
        name: "device_proxy_assign",
        description: "Asigna un proxy específico o el siguiente disponible a un dispositivo",
        inputSchema: {
            type: "object",
            properties: {
                device_id: { type: "string" },
                proxy_id: { type: "number" },
                strategy: { type: "string", enum: ["round_robin", "random"] },
                country: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
            },
            required: ["device_id"],
        },
    },
    {
        name: "device_proxy_rotate",
        description: "Cambia un dispositivo al siguiente proxy disponible",
        inputSchema: {
            type: "object",
            properties: {
                device_id: { type: "string" },
                strategy: { type: "string", enum: ["round_robin", "random"] },
                country: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
            },
            required: ["device_id"],
        },
    },
    {
        name: "device_proxy_clear",
        description: "Quita el proxy del dispositivo y libera la asignación",
        inputSchema: {
            type: "object",
            properties: { device_id: { type: "string" } },
            required: ["device_id"],
        },
    },
    {
        name: "device_proxy_check_ip",
        description: "Comprueba la IP de salida actual de un dispositivo",
        inputSchema: {
            type: "object",
            properties: { device_id: { type: "string" } },
            required: ["device_id"],
        },
    },

    // Group tools
    {
        name: "groups_list",
        description: "Lista los grupos de dispositivos",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "groups_create",
        description: "Crea un nuevo grupo de dispositivos",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string" },
                description: { type: "string" },
                max_devices: { type: "number" },
            },
            required: ["name"],
        },
    },
    {
        name: "groups_assign_devices",
        description: "Asigna dispositivos a un grupo",
        inputSchema: {
            type: "object",
            properties: {
                group_id: { type: "string" },
                device_ids: { type: "array", items: { type: "number" } },
            },
            required: ["group_id", "device_ids"],
        },
    },
    {
        name: "groups_pause",
        description: "Pausa un grupo: sus dispositivos dejan de recibir tareas nuevas",
        inputSchema: {
            type: "object",
            properties: { group_id: { type: "string" } },
            required: ["group_id"],
        },
    },
    {
        name: "groups_resume",
        description: "Reanuda un grupo pausado",
        inputSchema: {
            type: "object",
            properties: { group_id: { type: "string" } },
            required: ["group_id"],
        },
    },

    // Workflow tools
    {
        name: "workflows_list",
        description: "Lista los workflows definidos",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "workflows_create",
        description: "Crea un nuevo workflow con pasos de automatización (OPEN_APP, CLICK_BY_TEXT, SET_TEXT, PLAY_MEDIA, ...)",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string" },
                description: { type: "string" },
                steps: { type: "array" },
                allowed_package: { type: "string" },
            },
            required: ["name", "steps"],
        },
    },
    {
        name: "workflows_validate",
        description: "Valida la estructura y pasos de un workflow existente",
        inputSchema: {
            type: "object",
            properties: { workflow_id: { type: "string" } },
            required: ["workflow_id"],
        },
    },
    {
        name: "workflows_execute",
        description: "Ejecuta un workflow ahora en dispositivos específicos, un grupo, o todos los online",
        inputSchema: {
            type: "object",
            properties: {
                workflow_id: { type: "string" },
                group_id: { type: "string" },
                device_ids: { type: "array", items: { type: "number" } },
                params: { type: "object" },
            },
            required: ["workflow_id"],
        },
    },

    // Task tools
    {
        name: "tasks_list",
        description: "Lista tareas (filtrable por status)",
        inputSchema: {
            type: "object",
            properties: { status: { type: "string" } },
        },
    },
    {
        name: "tasks_schedule",
        description: "Programa una tarea para ejecución futura",
        inputSchema: {
            type: "object",
            properties: {
                workflow_id: { type: "string" },
                scheduled_at: { type: "string", description: "Fecha/hora ISO 8601 futura" },
                group_id: { type: "string" },
                device_ids: { type: "array", items: { type: "number" } },
                params: { type: "object" },
            },
            required: ["workflow_id", "scheduled_at"],
        },
    },
    {
        name: "tasks_cancel",
        description: "Cancela una tarea programada o en ejecución",
        inputSchema: {
            type: "object",
            properties: { task_id: { type: "string" } },
            required: ["task_id"],
        },
    },
    {
        name: "tasks_retry",
        description: "Reintenta una tarea que falló",
        inputSchema: {
            type: "object",
            properties: { task_id: { type: "string" } },
            required: ["task_id"],
        },
    },

    // Report tools
    {
        name: "reports_execution_summary",
        description: "Resumen de ejecución de tareas para un período (días)",
        inputSchema: {
            type: "object",
            properties: { period: { type: "string", description: "Días hacia atrás, ej. '7'" } },
        },
    },
    {
        name: "reports_device_failures",
        description: "Reporte de dispositivos con fallos frecuentes",
        inputSchema: {
            type: "object",
            properties: { period: { type: "string", description: "Días hacia atrás, ej. '30'" } },
        },
    },
    {
        name: "reports_daily_activity",
        description: "Actividad diaria del sistema",
        inputSchema: {
            type: "object",
            properties: { days: { type: "string", description: "Días hacia atrás, ej. '30'" } },
        },
    },

    // Schedule tools (rutinas programadas)
    {
        name: "schedules_list",
        description: "Lista las rutinas programadas (schedules) con su próxima ejecución y estado",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "schedules_create",
        description: "Crea una rutina programada: ejecuta un workflow en un grupo, a horas fijas o en bucle dentro de una franja horaria",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string" },
                workflow_id: { type: "number", description: "ID del workflow (la rutina de pasos)" },
                group_id: { type: "number", description: "ID del grupo (omitir = todos los dispositivos online)" },
                mode: { type: "string", enum: ["fixed_times", "loop"], description: "'fixed_times' = a horas concretas; 'loop' = repetir dentro de una franja" },
                times: { type: "array", items: { type: "string" }, description: "Horas HH:MM para modo fixed_times, ej. ['09:00','14:30']" },
                window_start: { type: "string", description: "Inicio de franja HH:MM (modo loop)" },
                window_end: { type: "string", description: "Fin de franja HH:MM (modo loop)" },
                loop_gap_seconds: { type: "number", description: "Pausa en segundos entre repeticiones del bucle" },
                days_of_week: { type: "array", items: { type: "number" }, description: "Días 0-6 (0=domingo); omitir = todos" },
            },
            required: ["name", "workflow_id", "mode"],
        },
    },
    {
        name: "schedules_pause",
        description: "Pausa una rutina programada (deja de dispararse)",
        inputSchema: { type: "object", properties: { schedule_id: { type: "number" } }, required: ["schedule_id"] },
    },
    {
        name: "schedules_resume",
        description: "Reanuda una rutina programada pausada",
        inputSchema: { type: "object", properties: { schedule_id: { type: "number" } }, required: ["schedule_id"] },
    },
    {
        name: "schedules_run_now",
        description: "Dispara una vuelta inmediata de la rutina de un schedule",
        inputSchema: { type: "object", properties: { schedule_id: { type: "number" } }, required: ["schedule_id"] },
    },
    {
        name: "schedules_delete",
        description: "Elimina una rutina programada",
        inputSchema: { type: "object", properties: { schedule_id: { type: "number" } }, required: ["schedule_id"] },
    },

    // Dashboard tools
    {
        name: "dashboard_stats",
        description: "Estadísticas generales del sistema (dispositivos, tareas, workflows, grupos)",
        inputSchema: { type: "object", properties: {} },
    },
];

// ============================================================
// API helpers
// ============================================================

function ok(data: unknown) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(error: any) {
    const detail = error.response?.data ?? error.message;
    return {
        content: [{ type: "text", text: `Error: ${JSON.stringify(detail)}` }],
        isError: true,
    };
}

async function apiGet(endpoint: string, params?: object) {
    try {
        const response = await api.get(endpoint, { params });
        return ok(response.data);
    } catch (error: any) {
        return fail(error);
    }
}

async function apiPost(endpoint: string, body?: object) {
    try {
        const response = await api.post(endpoint, body);
        return ok(response.data);
    } catch (error: any) {
        return fail(error);
    }
}

async function apiDelete(endpoint: string) {
    try {
        const response = await api.delete(endpoint);
        return ok(response.data);
    } catch (error: any) {
        return fail(error);
    }
}

// ============================================================
// Tool dispatch
// ============================================================

async function callTool(name: string, params: any) {
    switch (name) {
        case "devices_list":
            return apiGet("/devices");
        case "devices_get_status":
            return apiGet(`/devices/${params.device_id}`);
        case "devices_register":
            return apiPost("/devices", params);
        case "devices_stats":
            return apiGet("/devices/stats");
        case "devices_stabilize":
            return apiPost("/devices/batch-command", {
                device_ids: params.device_ids,
                command: "DEVICE_STABILIZE",
                params: {
                    keep_awake: params.keep_awake,
                    screen_timeout_minutes: params.screen_timeout_minutes,
                    animation_scale: params.animation_scale,
                    sync_time: params.sync_time,
                    timezone: params.timezone,
                },
            });
        case "devices_network_status":
            return apiPost("/devices/batch-command", {
                device_ids: params.device_ids,
                command: "DEVICE_NETWORK_STATUS",
                params: {},
            });
        case "devices_clear_proxy":
            return apiPost("/devices/batch-command", {
                device_ids: params.device_ids,
                command: "CLEAR_PROXY",
                params: {},
            });
        case "proxies_list":
            return apiGet("/proxies", { status: params.status, country: params.country });
        case "proxies_create":
            return apiPost("/proxies", params);
        case "proxies_import":
            return apiPost("/proxies/import", { proxies: params.proxies });
        case "proxies_distribute":
            return apiPost("/proxies/distribute", params);
        case "device_proxy_assign":
            return apiPost(`/devices/${params.device_id}/proxy/assign`, {
                proxy_id: params.proxy_id,
                strategy: params.strategy,
                country: params.country,
                tags: params.tags,
            });
        case "device_proxy_rotate":
            return apiPost(`/devices/${params.device_id}/proxy/rotate`, {
                strategy: params.strategy,
                country: params.country,
                tags: params.tags,
            });
        case "device_proxy_clear":
            return apiPost(`/devices/${params.device_id}/proxy/clear`);
        case "device_proxy_check_ip":
            return apiPost(`/devices/${params.device_id}/check-ip`);

        case "groups_list":
            return apiGet("/groups");
        case "groups_create":
            return apiPost("/groups", {
                name: params.name,
                description: params.description,
                max_devices: params.max_devices,
            });
        case "groups_assign_devices":
            return apiPost(`/groups/${params.group_id}/assign-devices`, {
                device_ids: params.device_ids,
            });
        case "groups_pause":
            return apiPost(`/groups/${params.group_id}/pause`);
        case "groups_resume":
            return apiPost(`/groups/${params.group_id}/resume`);

        case "workflows_list":
            return apiGet("/workflows");
        case "workflows_create":
            return apiPost("/workflows", {
                name: params.name,
                description: params.description,
                steps: params.steps,
                allowed_package: params.allowed_package,
            });
        case "workflows_validate":
            return apiPost(`/workflows/${params.workflow_id}/validate`);
        case "workflows_execute":
            return apiPost(`/workflows/${params.workflow_id}/execute`, {
                group_id: params.group_id,
                device_ids: params.device_ids,
                params: params.params,
            });

        case "tasks_list":
            return apiGet("/tasks", params.status ? { status: params.status } : undefined);
        case "tasks_schedule":
            return apiPost("/tasks", {
                workflow_id: params.workflow_id,
                scheduled_at: params.scheduled_at,
                group_id: params.group_id,
                device_ids: params.device_ids,
                params: params.params,
            });
        case "tasks_cancel":
            return apiPost(`/tasks/${params.task_id}/cancel`);
        case "tasks_retry":
            return apiPost(`/tasks/${params.task_id}/retry`);

        case "reports_execution_summary":
            return apiGet("/reports/execution-summary", { period: params.period });
        case "reports_device_failures":
            return apiGet("/reports/device-failures", { period: params.period });
        case "reports_daily_activity":
            return apiGet("/reports/daily-activity", { days: params.days });

        case "schedules_list":
            return apiGet("/schedules");
        case "schedules_create":
            return apiPost("/schedules", {
                name: params.name,
                workflow_id: params.workflow_id,
                group_id: params.group_id,
                mode: params.mode,
                times: params.times,
                window_start: params.window_start,
                window_end: params.window_end,
                loop_gap_seconds: params.loop_gap_seconds,
                days_of_week: params.days_of_week,
            });
        case "schedules_pause":
            return apiPost(`/schedules/${params.schedule_id}/pause`);
        case "schedules_resume":
            return apiPost(`/schedules/${params.schedule_id}/resume`);
        case "schedules_run_now":
            return apiPost(`/schedules/${params.schedule_id}/run-now`);
        case "schedules_delete":
            return apiDelete(`/schedules/${params.schedule_id}`);

        case "dashboard_stats":
            return apiGet("/dashboard/stats");

        default:
            return {
                content: [{ type: "text", text: `Tool desconocida: ${name}` }],
                isError: true,
            };
    }
}

// ============================================================
// MCP Server Setup
// ============================================================

async function main() {
    const server = new Server(
        { name: "mcp-appcontrol", version: "1.1.0" },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: TOOLS,
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        return callTool(request.params.name, request.params.arguments ?? {});
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP AppControl Server running on stdio");
}

main().catch(console.error);
