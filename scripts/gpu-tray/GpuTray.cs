// 🚦 GPU 사용자 표시기 (v1.0.15 · 로이 2026-11-04) — 작업표시줄 알림 영역에 「지금 GPU 를 누가 쓰나」.
//   상태 색: 원격 PC(보라) · 이 PC(초록) · 우리 서버 밖의 프로그램(주황) · 쉬는 중(회색)
//   👥 v1.0.45(로이 2026-11-06 「안 쓰는데 내가 쓴다고 나온다」): 옛판은 ComfyUI 에 그림이 하나라도 돌면 누구 것이든
//      「로이 렌더(프라이밍)」으로 보였다 → 음성·그림 줄마다 서버가 받은 「어느 PC · 어떤 프로그램」을 쓰고,
//      「실제:」 줄에 윈도우 성능 카운터로 잰 프로세스별 GPU 사용률을 함께 보인다. 오른쪽 클릭 「자세히 보기」.
//   읽는 곳(3초마다 · 이 PC 안에서만):
//     ① 음성 서버  http://127.0.0.1:9881/gpu-status  (X-API-Key = D:\TTS_Model\omnivoice\apikey.txt)
//     ② ComfyUI    http://127.0.0.1:8188/queue
//     ③ nvidia-smi  GPU 사용률 · VRAM
//   빌드·자동 시작 = 같은 폴더 install.ps1 (Windows 내장 C# 컴파일러 · 설치할 것 없음)
//   ⛔ 이 프로그램은 읽기만 한다 — 서버·GPU 에 아무것도 보내지 않는다.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class GpuTray
{
    const string OMNI = "http://127.0.0.1:9881/gpu-status";
    const string COMFY = "http://127.0.0.1:8188/queue";
    const string KEY_FILE = @"D:\TTS_Model\omnivoice\apikey.txt";
    const string PRIO_LOG = @"D:\TTS_Model\omnivoice\data\gpu-priority.log";
    const int OTHER_UTIL = 30;          // 우리 서버가 쉬는데 사용률이 이 이상이면 「그 밖의 프로그램」

    static NotifyIcon icon;
    static Dictionary<string, Icon> icons = new Dictionary<string, Icon>();
    static SynchronizationContext ui;
    static int polling = 0;
    static int otherStreak = 0;
    static string apiKey = "";

    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--dump")   // 시험용: 한 번 읽어 파일에 쓰고 끝낸다
        {
            try { apiKey = File.ReadAllText(KEY_FILE).Trim(); } catch { }
            string st, tp;
            Collect(out st, out tp);
            Thread.Sleep(1200);   // 성능 카운터는 두 번째 읽기부터 값이 나온다
            Collect(out st, out tp);
            File.WriteAllText(args[1], st + "\n" + tp + "\n----\n" + lastDetail, System.Text.Encoding.UTF8);
            return;
        }
        bool fresh;
        using (var m = new Mutex(true, "PrimingGpuTray", out fresh))
        {
            if (!fresh) return;   // 이미 떠 있다
            try { apiKey = File.ReadAllText(KEY_FILE).Trim(); } catch { }
            Application.EnableVisualStyles();
            ui = new WindowsFormsSynchronizationContext();
            SynchronizationContext.SetSynchronizationContext(ui);
            icons["remote"] = Dot(Color.FromArgb(142, 68, 173));
            icons["local"] = Dot(Color.FromArgb(39, 174, 96));
            icons["other"] = Dot(Color.FromArgb(230, 126, 34));
            icons["idle"] = Dot(Color.FromArgb(149, 165, 166));
            var menu = new ContextMenuStrip();
            menu.Items.Add("자세히 보기", null, (s, e) => MessageBox.Show(lastDetail.Length > 0 ? lastDetail : "아직 읽는 중입니다", "GPU 사용자 표시기"));
            menu.Items.Add("우선 처리 기록 열기", null, (s, e) => { try { Process.Start("notepad.exe", "\"" + PRIO_LOG + "\""); } catch { } });
            menu.Items.Add("종료", null, (s, e) => { icon.Visible = false; Application.Exit(); });
            icon = new NotifyIcon { Icon = icons["idle"], Text = "GPU 확인 중…", ContextMenuStrip = menu, Visible = true };
            var t = new System.Windows.Forms.Timer { Interval = 3000 };
            t.Tick += (s, e) => Poll();
            t.Start();
            Poll();
            Application.Run();
            icon.Visible = false;
        }
    }

    static Icon Dot(Color c)
    {
        using (var b = new Bitmap(16, 16))
        {
            using (var g = Graphics.FromImage(b))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using (var br = new SolidBrush(c)) g.FillEllipse(br, 1, 1, 14, 14);
                using (var p = new Pen(Color.FromArgb(200, 255, 255, 255), 1)) g.DrawEllipse(p, 1, 1, 14, 14);
            }
            IntPtr h = b.GetHicon();
            var ic = (Icon)Icon.FromHandle(h).Clone();
            DestroyIcon(h);
            return ic;
        }
    }

    static void Poll()
    {
        if (Interlocked.Exchange(ref polling, 1) == 1) return;   // 앞 조회가 아직이면 건너뜀
        ThreadPool.QueueUserWorkItem(_ =>
        {
            string state, tip;
            try { Collect(out state, out tip); }
            catch (Exception ex) { state = "idle"; tip = "GPU 확인 실패: " + ex.Message; }
            ui.Post(__ => { icon.Icon = icons[state]; SetTip(tip); }, null);
            Interlocked.Exchange(ref polling, 0);
        });
    }

    static Dictionary<string, object> GetJson(string url, bool key)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout = 2000; req.ReadWriteTimeout = 2000; req.Proxy = null;
            if (key && apiKey.Length > 0) req.Headers["X-API-Key"] = apiKey;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var rd = new StreamReader(res.GetResponseStream()))
                return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(rd.ReadToEnd());
        }
        catch { return null; }
    }

    static int Num(Dictionary<string, object> d, string k)
    {
        object v;
        if (d == null || !d.TryGetValue(k, out v) || v == null) return 0;
        try { return Convert.ToInt32(v); } catch { return 0; }
    }

    static int Len(Dictionary<string, object> d, string k)
    {
        object v;
        if (d == null || !d.TryGetValue(k, out v)) return 0;
        var a = v as System.Collections.ICollection;
        return a == null ? 0 : a.Count;
    }

    static string Str(Dictionary<string, object> d, string k)
    {
        object v;
        return d != null && d.TryGetValue(k, out v) && v != null ? v.ToString() : "";
    }

    static void Smi(out int util, out int memUsed, out int memTotal)
    {
        util = -1; memUsed = 0; memTotal = 0;
        try
        {
            var psi = new ProcessStartInfo("nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits")
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
            using (var p = Process.Start(psi))
            {
                string o = p.StandardOutput.ReadToEnd();
                p.WaitForExit(3000);
                var f = o.Trim().Split('\n')[0].Split(',');
                util = int.Parse(f[0].Trim()); memUsed = int.Parse(f[1].Trim()); memTotal = int.Parse(f[2].Trim());
            }
        }
        catch { }
    }

    static Dictionary<string, object> Obj(Dictionary<string, object> d, string k)
    {
        object v;
        return d != null && d.TryGetValue(k, out v) ? v as Dictionary<string, object> : null;
    }

    static List<Dictionary<string, object>> Arr(Dictionary<string, object> d, string k)
    {
        var r = new List<Dictionary<string, object>>();
        object v;
        if (d == null || !d.TryGetValue(k, out v)) return r;
        var a = v as System.Collections.IEnumerable;
        if (a == null) return r;
        foreach (var x in a) { var o = x as Dictionary<string, object>; if (o != null) r.Add(o); }
        return r;
    }

    static bool IsRemote(Dictionary<string, object> u)
    {
        object v;
        return u != null && u.TryGetValue("remote", out v) && v is bool && (bool)v;
    }

    // 👥 「어느 PC · 어떤 프로그램」 한 줄 — 서버 /gpu-status 의 tts_user · img_users 항목(v1.0.45)
    static string WhoText(Dictionary<string, object> u) { return Str(u, "pc") + " · " + Str(u, "app"); }

    // 🔎 실제로 GPU 를 쓰는 프로세스(윈도우 성능 카운터 「GPU Engine」 3D·Compute 사용률을 프로세스별로 더한다)
    //   서버 기록과 상관없이 「지금 누가 GPU 를 돌리나」를 직접 잰다 — 서버에 알리지 않는 프로그램도 잡힌다.
    static Dictionary<string, PerformanceCounter> engCtr = new Dictionary<string, PerformanceCounter>();
    static Dictionary<int, string> nameCache = new Dictionary<int, string>();

    static void TopGpuProcs(out string top, out int topPct)
    {
        top = ""; topPct = 0;
        try
        {
            var cat = new PerformanceCounterCategory("GPU Engine");
            var names = cat.GetInstanceNames();
            var live = new HashSet<string>();
            var byPid = new Dictionary<int, float>();
            foreach (var n in names)
            {
                if (n.IndexOf("engtype_3D", StringComparison.OrdinalIgnoreCase) < 0 && n.IndexOf("engtype_Compute", StringComparison.OrdinalIgnoreCase) < 0) continue;
                live.Add(n);
                PerformanceCounter c;
                if (!engCtr.TryGetValue(n, out c)) { c = new PerformanceCounter("GPU Engine", "Utilization Percentage", n, true); engCtr[n] = c; c.NextValue(); continue; }
                float v;
                try { v = c.NextValue(); } catch { continue; }
                int us = n.IndexOf('_', 4);
                int pid;
                if (!n.StartsWith("pid_") || us < 0 || !int.TryParse(n.Substring(4, us - 4), out pid)) continue;
                float cur; byPid.TryGetValue(pid, out cur); byPid[pid] = cur + v;
            }
            foreach (var k in new List<string>(engCtr.Keys)) if (!live.Contains(k)) { try { engCtr[k].Dispose(); } catch { } engCtr.Remove(k); }
            var list = new List<KeyValuePair<int, float>>(byPid);
            list.Sort((a, b) => b.Value.CompareTo(a.Value));
            var parts = new List<string>();
            foreach (var kv in list)
            {
                if (kv.Value < 5 || parts.Count >= 2) break;
                if (parts.Count == 0) topPct = (int)Math.Round(kv.Value);
                parts.Add(ProcName(kv.Key) + " " + Math.Round(Math.Min(100, kv.Value)) + "%");
            }
            top = string.Join(", ", parts);
        }
        catch { }
    }

    static string ProcName(int pid)
    {
        string s;
        if (nameCache.TryGetValue(pid, out s)) return s;
        string name = "pid " + pid, cmd = "";
        try { name = Process.GetProcessById(pid).ProcessName; } catch { }
        try
        {
            using (var q = new System.Management.ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId=" + pid))
                foreach (System.Management.ManagementObject o in q.Get()) cmd = (o["CommandLine"] ?? "").ToString().ToLowerInvariant();
        }
        catch { }
        string label;
        if (cmd.Contains("comfy")) label = "ComfyUI(그림)";
        else if (cmd.Contains("start_server.pyw") || cmd.Contains("omnivoice")) label = "음성 서버";
        else if (cmd.Contains("qwen_design")) label = "보이스디자인";
        else if (cmd.Contains("realesrgan") || name.ToLowerInvariant().Contains("realesrgan")) label = "업스케일";
        else if (name.ToLowerInvariant() == "ffmpeg") label = "ffmpeg(영상 굽기)";
        else if (name.ToLowerInvariant() == "dwm") label = "윈도우 화면";
        else if (name.ToLowerInvariant() == "ego" || name.ToLowerInvariant() == "chrome" || name.ToLowerInvariant() == "msedge") label = name + " 브라우저";
        else if (name.ToLowerInvariant() == "electron" || name.ToLowerInvariant() == "priming") label = "Priming";
        else if (name.ToLowerInvariant().StartsWith("pythonw") && cmd.Length == 0) label = "파이썬(관리자 · 음성 서버로 보임)";
        else label = name;
        nameCache[pid] = label;
        return label;
    }

    static string lastDetail = "";

    static void Collect(out string state, out string tip)
    {
        var omni = GetJson(OMNI, true);
        if (omni == null)   // 옛 서버(/gpu-status 없음) — 바쁜지만 안다(누구인지는 모름)
        {
            var b = GetJson(OMNI.Replace("/gpu-status", "/busy"), true);
            if (b != null) omni = new Dictionary<string, object> { { "busy", Num(b, "n") } };
        }
        var comfy = GetJson(COMFY, false);
        int util, mu, mt;
        Smi(out util, out mu, out mt);
        string top; int topPct;
        TopGpuProcs(out top, out topPct);

        int waitR = Num(omni, "wait_remote"), waitL = Num(omni, "wait_local"), busy = Num(omni, "busy");
        int comfyRun = Len(comfy, "queue_running"), comfyWait = Len(comfy, "queue_pending");
        var tts = Obj(omni, "tts_user");
        var imgs = Arr(omni, "img_users");
        var recent = Arr(omni, "tts_recent");

        // 음성 줄 — 지금 합성 중인 쪽 · 없으면 방금(15초 안) 만든 쪽 · 그것도 없으면 쉼
        string voice;
        bool anyRemote = false, anyLocal = false;
        if (tts != null) { voice = "음성: " + WhoText(tts); if (IsRemote(tts)) anyRemote = true; else anyLocal = true; }
        else if (recent.Count > 0) { voice = "음성: " + WhoText(recent[0]) + " (방금)"; if (IsRemote(recent[0])) anyRemote = true; else anyLocal = true; }
        else voice = busy > 0 ? "음성: 만드는 중(누구인지 모름 · 옛 서버)" : "음성: 쉼";

        // 그림 줄 — ComfyUI 가 돌면 「그리는 중」 신호를 보낸 쪽(1분마다 · 90초 안) · 신호 없이 돌면 그렇다고 쓴다
        string image;
        if (imgs.Count > 0)
        {
            var names = new List<string>();
            foreach (var u in imgs) { names.Add(WhoText(u)); if (IsRemote(u)) anyRemote = true; else anyLocal = true; }
            image = "그림: " + string.Join(" / ", names) + (comfyRun == 0 ? " (대기열 빔)" : "");
        }
        else if (comfyRun > 0) image = "그림: ComfyUI 작업 중 · 보낸 쪽 모름(신호 없음)";
        else image = "그림: 쉼";

        string head;
        if (anyRemote) { state = "remote"; otherStreak = 0; }
        else if (anyLocal || comfyRun > 0) { state = "local"; otherStreak = 0; }
        else if (util >= OTHER_UTIL && ++otherStreak >= 2) state = "other";
        else { if (util < OTHER_UTIL) otherStreak = 0; state = "idle"; }
        head = state == "other" ? "GPU: 우리 서버 밖의 프로그램" : state == "idle" ? "GPU: 쉬는 중" : "GPU 사용 중";

        string l2 = util >= 0 ? string.Format("사용률 {0}% · VRAM {1:0.0}/{2:0}GB", util, mu / 1024.0, mt / 1024.0) : "nvidia-smi 못 읽음";
        string lTop = top.Length > 0 ? "실제: " + top : "실제: GPU 쓰는 프로세스 없음";
        int waitAll = waitR + waitL + comfyWait;
        string lWait = omni == null ? "음성 서버 응답 없음" : string.Format("대기 {0}건(원격 {1} · 이 PC {2})", waitAll, waitR, waitL + comfyWait);

        tip = head + " · " + l2 + "\n" + voice + "\n" + image + "\n" + lTop;
        lastDetail = head + "\n" + l2 + "\n\n" + voice + "\n" + image + "\n\n" + lTop + "\n" + lWait
            + "\n\n※ 음성·그림 줄 = 음성 서버가 받은 요청의 보낸 PC·프로그램\n※ 실제 = 윈도우가 잰 프로세스별 GPU 사용률";
    }

    // NotifyIcon.Text 는 .NET 에서 63자로 막혀 있지만 윈도우는 127자까지 보여 준다 — 내부 필드로 넣는다(실패하면 63자로 자른다).
    static void SetTip(string tip)
    {
        if (tip.Length > 127) tip = tip.Substring(0, 127);
        try
        {
            var t = typeof(NotifyIcon);
            var f = t.GetField("text", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            f.SetValue(icon, tip);
            var added = t.GetField("added", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            if ((bool)added.GetValue(icon))
                t.GetMethod("UpdateIcon", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).Invoke(icon, new object[] { true });
        }
        catch { icon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip; }
    }
}
