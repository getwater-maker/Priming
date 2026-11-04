// 🚦 GPU 사용자 표시기 (v1.0.15 · 로이 2026-11-04) — 작업표시줄 알림 영역에 「지금 GPU 를 누가 쓰나」.
//   상태: 아내분(보라) · 로이 렌더(초록) · 그 밖의 프로그램(주황) · 쉬는 중(회색)
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
            File.WriteAllText(args[1], st + "\n" + tp, System.Text.Encoding.UTF8);
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
            ui.Post(__ => { icon.Icon = icons[state]; icon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip; }, null);
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

    static void Collect(out string state, out string tip)
    {
        var omni = GetJson(OMNI, true);
        if (omni == null)   // 옛 서버(/gpu-status 없음) — 바쁜지만 안다(누구인지는 모름 → 이 PC 로 본다)
        {
            var b = GetJson(OMNI.Replace("/gpu-status", "/busy"), true);
            if (b != null) omni = new Dictionary<string, object> { { "busy", Num(b, "n") } };
        }
        var comfy = GetJson(COMFY, false);
        int util, mu, mt;
        Smi(out util, out mu, out mt);

        string holder = Str(omni, "holder");
        int waitR = Num(omni, "wait_remote"), waitL = Num(omni, "wait_local"), busy = Num(omni, "busy");
        int comfyRun = Len(comfy, "queue_running"), comfyWait = Len(comfy, "queue_pending");
        string who = Str(omni, "remote_name");
        if (who.Length == 0) who = "원격";

        string head;
        if (holder == "remote" || waitR > 0) { state = "remote"; head = who + " 사용 중"; otherStreak = 0; }
        else if (holder == "local" || busy > 0 || comfyRun > 0) { state = "local"; head = "로이 렌더(프라이밍)" + (comfyRun > 0 && holder != "local" ? " · 그림" : " · 음성"); otherStreak = 0; }
        else if (util >= OTHER_UTIL && ++otherStreak >= 2) { state = "other"; head = "그 밖의 프로그램"; }
        else { if (util < OTHER_UTIL) otherStreak = 0; state = "idle"; head = "쉬는 중"; }

        string l2 = util >= 0 ? string.Format("사용률 {0}% · VRAM {1:0.0}/{2:0}GB", util, mu / 1024.0, mt / 1024.0) : "nvidia-smi 못 읽음";
        int waitAll = waitR + waitL + comfyWait;
        string l3 = omni == null ? "음성 서버 응답 없음" : string.Format("대기 {0}건(원격 {1} · 이 PC {2})", waitAll, waitR, waitL + comfyWait);
        tip = "GPU: " + head + "\n" + l2 + "\n" + l3;
    }
}
