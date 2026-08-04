/*
 * GA-PDF-Editor-SVC.exe — tiny localhost static file server for app\
 *
 *  - Serves ./app on 127.0.0.1 only (no admin for high ports)
 *  - Single instance via named mutex
 *  - Does NOT open a browser (startup-friendly; PWA install is manual once)
 *  - Writes "Open GA PDF Editor.url" next to the EXE with the live port
 *  - Sticky port: prefer CLI/env, else port from existing .url file, else 17880
 *  - Never silently hops ports (that would break an installed PWA origin)
 *  - Port busy: MessageBox with last-port / PWA guidance
 *
 * Port override: --port N | -p N | GAPDF_SVC_PORT
 */
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "libs\mongoose.h"

#define DEFAULT_PORT     17880
#define MUTEX_NAME       "Local\\GA-PDF-Editor-SVC-SingleInstance"
#define PORT_FILE_SUB    "GA-PDF-Editor\\svc.port"
#define URL_FILE_NAME    "Open GA PDF Editor.url"
#define URL_FMT          "http://127.0.0.1:%d/"

static int g_port = DEFAULT_PORT;

static void http_handler(struct mg_connection *c, int ev, void *ev_data) {
  if (ev == MG_EV_HTTP_MSG) {
    struct mg_http_serve_opts opts = {.root_dir = "./app"};
    mg_http_serve_dir(c, (struct mg_http_message *) ev_data, &opts);
  }
}

static int port_file_path(char *out, size_t out_sz) {
  char base[MAX_PATH];
  DWORD n = GetEnvironmentVariableA("LOCALAPPDATA", base, (DWORD)sizeof(base));
  if (n == 0 || n >= sizeof(base)) return 0;
  if (snprintf(out, out_sz, "%s\\%s", base, PORT_FILE_SUB) >= (int)out_sz) return 0;
  return 1;
}

static void ensure_parent_dir(const char *file_path) {
  char dir[MAX_PATH];
  char *slash;
  strncpy(dir, file_path, sizeof(dir) - 1);
  dir[sizeof(dir) - 1] = '\0';
  slash = strrchr(dir, '\\');
  if (!slash) return;
  *slash = '\0';
  CreateDirectoryA(dir, NULL);
}

static int exe_dir(char *out, size_t out_sz) {
  char path[MAX_PATH];
  char *slash;
  DWORD n = GetModuleFileNameA(NULL, path, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) return 0;
  slash = strrchr(path, '\\');
  if (!slash) return 0;
  *slash = '\0';
  if (strlen(path) + 1 > out_sz) return 0;
  memcpy(out, path, strlen(path) + 1);
  return 1;
}

static void chdir_to_exe(void) {
  char dir[MAX_PATH];
  if (exe_dir(dir, sizeof(dir))) SetCurrentDirectoryA(dir);
}

static void write_port_file(int port) {
  char path[MAX_PATH];
  FILE *f;
  if (!port_file_path(path, sizeof(path))) return;
  ensure_parent_dir(path);
  f = fopen(path, "w");
  if (!f) return;
  fprintf(f, "%d\n", port);
  fclose(f);
}

static void url_file_path(char *out, size_t out_sz) {
  char dir[MAX_PATH];
  out[0] = '\0';
  if (!exe_dir(dir, sizeof(dir))) return;
  snprintf(out, out_sz, "%s\\%s", dir, URL_FILE_NAME);
}

/*
 * Read port from existing Internet Shortcut next to the EXE.
 * PWA is installed against a fixed origin (host:port) — we must stick to it.
 */
static int read_port_from_url_file(void) {
  char path[MAX_PATH];
  char line[256];
  FILE *f;
  int port = 0;

  url_file_path(path, sizeof(path));
  if (!path[0]) return 0;
  f = fopen(path, "r");
  if (!f) return 0;

  while (fgets(line, sizeof(line), f)) {
    /* URL=http://127.0.0.1:17880/  or  URL=http://127.0.0.1:17880 */
    char *p = strstr(line, "URL=");
    if (!p) continue;
    p = strstr(p, "://");
    if (!p) continue;
    p = strchr(p + 3, ':'); /* host:port */
    if (!p) continue;
    port = atoi(p + 1);
    break;
  }
  fclose(f);
  if (port < 1 || port > 65535) return 0;
  return port;
}

static int read_port_file(void) {
  char path[MAX_PATH];
  char buf[64];
  FILE *f;
  int p = 0;
  if (!port_file_path(path, sizeof(path))) return 0;
  f = fopen(path, "r");
  if (!f) return 0;
  if (fgets(buf, sizeof(buf), f)) p = atoi(buf);
  fclose(f);
  if (p < 1 || p > 65535) return 0;
  return p;
}

static void write_url_shortcut(int port) {
  char path[MAX_PATH];
  FILE *f;
  url_file_path(path, sizeof(path));
  if (!path[0]) return;
  f = fopen(path, "w");
  if (!f) return;
  fprintf(f,
          "[InternetShortcut]\r\n"
          "URL=http://127.0.0.1:%d/\r\n"
          "IconIndex=0\r\n",
          port);
  fclose(f);
}

static int parse_port_arg(const char *cmd) {
  const char *p;
  int port;

  if (!cmd || !*cmd) return 0;

  p = strstr(cmd, "--port");
  if (!p) p = strstr(cmd, "-p ");
  if (!p) p = strstr(cmd, "-p\t");
  if (p) {
    p += (p[1] == '-') ? 6 : 2;
    while (*p == ' ' || *p == '=' || *p == '\t') p++;
    port = atoi(p);
    if (port >= 1 && port <= 65535) return port;
  }

  p = strstr(cmd, "/port=");
  if (p) {
    port = atoi(p + 6);
    if (port >= 1 && port <= 65535) return port;
  }

  return 0;
}

/*
 * Priority:
 *  1) Explicit CLI / env (user is intentionally changing port)
 *  2) Port already in Open GA PDF Editor.url (PWA sticky origin)
 *  3) Last port file
 *  4) Default 17880
 */
static int resolve_port(const char *cmd, int *from_url_file, int *explicit_override) {
  char env[32];
  int port;
  DWORD n;

  *from_url_file = 0;
  *explicit_override = 0;

  n = GetEnvironmentVariableA("GAPDF_SVC_PORT", env, (DWORD)sizeof(env));
  if (n > 0 && n < sizeof(env)) {
    port = atoi(env);
    if (port >= 1 && port <= 65535) {
      *explicit_override = 1;
      return port;
    }
  }

  port = parse_port_arg(cmd);
  if (port) {
    *explicit_override = 1;
    return port;
  }

  port = read_port_from_url_file();
  if (port) {
    *from_url_file = 1;
    return port;
  }

  port = read_port_file();
  if (port) return port;

  return DEFAULT_PORT;
}

static void show_err(const char *title, const char *msg) {
  MessageBoxA(NULL, msg, title, MB_OK | MB_ICONERROR);
}

static void show_port_busy(int port, int had_url_file) {
  char msg[700];

  if (had_url_file) {
    snprintf(msg, sizeof(msg),
             "Could not listen on http://127.0.0.1:%d/\n\n"
             "That is the port stored in \"Open GA PDF Editor.url\" — the same origin "
             "an installed PWA uses.\n\n"
             "If something else is holding this port (or a previous crash left it "
             "hung), the installed app will fail until the port is free again.\n\n"
             "What to do:\n"
             "  1. Close any other program using port %d (or reboot).\n"
             "  2. Start GA-PDF-Editor-SVC.exe again.\n\n"
             "Only if you must change ports (breaks the old PWA origin):\n"
             "  GA-PDF-Editor-SVC.exe --port 27991\n"
             "  then open the new \"Open GA PDF Editor.url\" and re-install the PWA.\n\n"
             "This service will NOT silently switch ports.",
             port, port);
  } else {
    snprintf(msg, sizeof(msg),
             "Could not listen on http://127.0.0.1:%d/\n\n"
             "Port may already be in use.\n\n"
             "Try freeing the port, or start with:\n"
             "  GA-PDF-Editor-SVC.exe --port 27991\n"
             "Or set environment variable GAPDF_SVC_PORT.\n\n"
             "This service will NOT silently switch ports (that would break a PWA).",
             port);
  }

  show_err("GA PDF Editor — port unavailable", msg);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrev, LPSTR cmd, int show) {
  HANDLE mutex;
  struct mg_mgr mgr;
  char listen[64];
  struct mg_connection *c;
  DWORD err;
  int from_url = 0;
  int explicit_override = 0;
  const char *cmdline;

  (void)hInstance;
  (void)hPrev;
  (void)show;

  chdir_to_exe();
  cmdline = (cmd && cmd[0]) ? cmd : GetCommandLineA();
  g_port = resolve_port(cmdline, &from_url, &explicit_override);

  /* Single instance — second launch exits quietly */
  mutex = CreateMutexA(NULL, TRUE, MUTEX_NAME);
  err = GetLastError();
  if (!mutex) {
    show_err("GA PDF Editor", "Could not create single-instance lock.");
    return 1;
  }

  if (err == ERROR_ALREADY_EXISTS) {
    CloseHandle(mutex);
    return 0;
  }

  mg_mgr_init(&mgr);

  snprintf(listen, sizeof(listen), "http://127.0.0.1:%d", g_port);
  c = mg_http_listen(&mgr, listen, http_handler, NULL);
  if (c == NULL) {
    /*
     * Prefer sticky PWA port. Do not auto-scan for another port.
     * If bind failed and we had a URL-file port (or any sticky choice),
     * tell the user clearly — especially when the .url / PWA origin is involved.
     */
    show_port_busy(g_port, from_url || read_port_from_url_file() > 0);

    mg_mgr_free(&mgr);
    ReleaseMutex(mutex);
    CloseHandle(mutex);
    return 2;
  }

  write_port_file(g_port);
  write_url_shortcut(g_port);

  /* No browser — user opens "Open GA PDF Editor.url" once for PWA install */

  for (;;) {
    mg_mgr_poll(&mgr, 1000);
  }

  mg_mgr_free(&mgr);
  ReleaseMutex(mutex);
  CloseHandle(mutex);
  return 0;
}
