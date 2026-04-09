export const WINDOW_RECT_EVENT_HOOK_CS = `
    using System;
    using System.Collections.Generic;
    using System.Runtime.InteropServices;
    using System.Text;
    public class WinHook {
      public delegate void WinEventProc(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

      [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventProc lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);
      [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hWinEventHook);
      [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
      [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

      [StructLayout(LayoutKind.Sequential)]
      public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

      static readonly object Sync = new object();
      static readonly HashSet<long> WatchRoots = new HashSet<long>();
      static readonly Dictionary<long, long> RootToOrig = new Dictionary<long, long>();
      static readonly Dictionary<long, long> OrigToRoot = new Dictionary<long, long>();
      static readonly Dictionary<long, string> Last = new Dictionary<long, string>();

      static IntPtr Hook = IntPtr.Zero;
      static WinEventProc Proc = new WinEventProc(Callback);

      public static void Start() {
        if (Hook != IntPtr.Zero) return;
        uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
        uint WINEVENT_OUTOFCONTEXT = 0x0000;
        uint WINEVENT_SKIPOWNPROCESS = 0x0002;
        Hook = SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, IntPtr.Zero, Proc, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
      }

      public static void Stop() {
        if (Hook == IntPtr.Zero) return;
        try { UnhookWinEvent(Hook); } catch { }
        Hook = IntPtr.Zero;
      }

      public static void Add(long hwnd) {
        IntPtr h = new IntPtr(hwnd);
        IntPtr root = GetAncestor(h, 3); // GA_ROOTOWNER
        if (root == IntPtr.Zero) root = h;
        long rootId = root.ToInt64();
        lock (Sync) {
          WatchRoots.Add(rootId);
          RootToOrig[rootId] = hwnd;
          OrigToRoot[hwnd] = rootId;
        }
      }

      public static void Remove(long hwnd) {
        lock (Sync) {
          long rootId;
          if (!OrigToRoot.TryGetValue(hwnd, out rootId)) return;
          OrigToRoot.Remove(hwnd);
          RootToOrig.Remove(rootId);
          WatchRoots.Remove(rootId);
          Last.Remove(rootId);
        }
      }

      public static void Clear() {
        lock (Sync) {
          WatchRoots.Clear();
          RootToOrig.Clear();
          OrigToRoot.Clear();
          Last.Clear();
        }
      }

      static void Callback(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime) {
        if (hwnd == IntPtr.Zero) return;
        if (idObject != 0 || idChild != 0) return; // OBJID_WINDOW && CHILDID_SELF

        IntPtr root = GetAncestor(hwnd, 3); // GA_ROOTOWNER
        if (root == IntPtr.Zero) root = hwnd;
        long rootId = root.ToInt64();

        long origId = 0;
        bool watched = false;
        lock (Sync) {
          watched = WatchRoots.Contains(rootId);
          if (watched && RootToOrig.ContainsKey(rootId)) origId = RootToOrig[rootId];
        }
        if (!watched) return;
        if (origId == 0) origId = rootId;

        RECT r;
        if (!GetWindowRect(root, out r)) return;

        string rectKey = r.Left.ToString() + "," + r.Top.ToString() + "," + r.Right.ToString() + "," + r.Bottom.ToString();
        lock (Sync) {
          string prev;
          if (Last.TryGetValue(rootId, out prev) && prev == rectKey) return;
          Last[rootId] = rectKey;
        }

        string json = "{\\"hwnd\\":\\"" + origId.ToString() + "\\",\\"rect\\":{\\"left\\":" + r.Left.ToString() + ",\\"top\\":" + r.Top.ToString() + ",\\"right\\":" + r.Right.ToString() + ",\\"bottom\\":" + r.Bottom.ToString() + "}}";
        string b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
        Console.WriteLine("EVT|" + b64);
      }
    }
`

export const WINDOW_RECT_EVENT_RUNNER_PS = `
  $in = [Console]::In
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $ErrorActionPreference = 'Stop'

  Add-Type @"
${WINDOW_RECT_EVENT_HOOK_CS}
"@

  [WinHook]::Start()

  while ($true) {
    $line = $in.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq '__EXIT__') { break }
    if (-not $line.Trim()) { continue }
    $parts = $line.Split('|', 2)
    if ($parts.Count -lt 1) { continue }
    $cmd = $parts[0]
    $arg = if ($parts.Count -ge 2) { $parts[1] } else { '' }
    try {
      if ($cmd -eq 'ADD') { [WinHook]::Add([Int64]$arg) }
      elseif ($cmd -eq 'DEL') { [WinHook]::Remove([Int64]$arg) }
      elseif ($cmd -eq 'CLR') { [WinHook]::Clear() }
    } catch { }
  }

  try { [WinHook]::Stop() } catch { }
  exit
`

export const PINNED_BORDER_CS = `
    using System;
    using System.Collections.Generic;
    using System.Drawing;
    using System.Drawing.Drawing2D;
    using System.Runtime.InteropServices;
    using System.Threading;
    using System.Windows.Forms;

    public class PinnedBorder {
      public delegate void WinEventProc(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

      [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventProc lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);
      [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hWinEventHook);
      [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
      [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
      [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
      [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
      [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);

      [StructLayout(LayoutKind.Sequential)]
      public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

      static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
      const uint SWP_NOSIZE = 0x0001;
      const uint SWP_NOMOVE = 0x0002;
      const uint SWP_NOACTIVATE = 0x0010;
      const uint SWP_SHOWWINDOW = 0x0040;

      class BorderForm : Form {
        public Color BorderColor = Color.FromArgb(0, 0, 0);
        public int BorderWidth = 3;

        public BorderForm() {
          this.FormBorderStyle = FormBorderStyle.None;
          this.ShowInTaskbar = false;
          this.TopMost = true;
          this.StartPosition = FormStartPosition.Manual;
          this.BackColor = Color.Lime;
          this.TransparencyKey = Color.Lime;
          this.DoubleBuffered = true;
        }

        protected override CreateParams CreateParams {
          get {
            const int WS_EX_TOOLWINDOW = 0x00000080;
            const int WS_EX_TRANSPARENT = 0x00000020;
            const int WS_EX_LAYERED = 0x00080000;
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_LAYERED;
            return cp;
          }
        }

        protected override void OnPaint(PaintEventArgs e) {
          base.OnPaint(e);
          int w = Math.Max(1, this.BorderWidth);
          Rectangle rect = new Rectangle(0, 0, this.ClientSize.Width - 1, this.ClientSize.Height - 1);
          rect.Inflate(-w / 2, -w / 2);
          using (Pen pen = new Pen(this.BorderColor, w)) {
            pen.Alignment = PenAlignment.Inset;
            int radius = 8;
            using (GraphicsPath path = RoundedRect(rect, radius)) {
              e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
              e.Graphics.DrawPath(pen, path);
            }
          }
        }

        static GraphicsPath RoundedRect(Rectangle bounds, int radius) {
          int d = radius * 2;
          GraphicsPath path = new GraphicsPath();
          if (radius <= 0) {
            path.AddRectangle(bounds);
            path.CloseFigure();
            return path;
          }
          path.AddArc(bounds.Left, bounds.Top, d, d, 180, 90);
          path.AddArc(bounds.Right - d, bounds.Top, d, d, 270, 90);
          path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
          path.AddArc(bounds.Left, bounds.Bottom - d, d, d, 90, 90);
          path.CloseFigure();
          return path;
        }
      }

      static readonly object Sync = new object();
      static readonly Dictionary<long, long> RootToOrig = new Dictionary<long, long>();
      static readonly Dictionary<long, long> OrigToRoot = new Dictionary<long, long>();
      static readonly Dictionary<long, BorderForm> Borders = new Dictionary<long, BorderForm>();
      static readonly Dictionary<long, string> Last = new Dictionary<long, string>();

      static IntPtr HookLoc = IntPtr.Zero;
      static IntPtr HookFg = IntPtr.Zero;
      static WinEventProc Proc = new WinEventProc(Callback);

      static Thread UiThread = null;
      static Control Ui = null;

      static void EnsureUi() {
        if (UiThread != null) return;
        UiThread = new Thread(() => {
          try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { try { SetProcessDPIAware(); } catch { } }
          Application.EnableVisualStyles();
          Application.SetCompatibleTextRenderingDefault(false);
          Ui = new Control();
          Ui.CreateControl();
          Application.Run();
        });
        UiThread.IsBackground = true;
        UiThread.SetApartmentState(ApartmentState.STA);
        UiThread.Start();
        while (Ui == null || !Ui.IsHandleCreated) { Thread.Sleep(10); }
      }

      public static void Start() {
        EnsureUi();
        if (HookLoc != IntPtr.Zero || HookFg != IntPtr.Zero) return;
        uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B;
        uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        uint WINEVENT_OUTOFCONTEXT = 0x0000;
        uint WINEVENT_SKIPOWNPROCESS = 0x0002;
        HookLoc = SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, IntPtr.Zero, Proc, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
        HookFg = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, Proc, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
      }

      public static void Stop() {
        try {
          lock (Sync) {
            foreach (var kv in Borders) {
              try { kv.Value.BeginInvoke(new Action(() => kv.Value.Close())); } catch { }
            }
            Borders.Clear();
            RootToOrig.Clear();
            OrigToRoot.Clear();
            Last.Clear();
          }
        } catch { }
        if (HookLoc != IntPtr.Zero) {
          try { UnhookWinEvent(HookLoc); } catch { }
          HookLoc = IntPtr.Zero;
        }
        if (HookFg != IntPtr.Zero) {
          try { UnhookWinEvent(HookFg); } catch { }
          HookFg = IntPtr.Zero;
        }
        try { if (Ui != null) Ui.BeginInvoke(new Action(() => Application.ExitThread())); } catch { }
        Ui = null;
        UiThread = null;
      }

      static void ApplyStyle(BorderForm f, string color, int width) {
        int a = 255;
        int r = 59;
        int g = 130;
        int b = 246;
        string v = (color ?? "").Trim();
        if (v.StartsWith("#")) v = v.Substring(1);
        if (v.Length == 3) {
          string rr = new string(v[0], 2);
          string gg = new string(v[1], 2);
          string bb = new string(v[2], 2);
          v = rr + gg + bb;
        }
        if (v.Length == 6 || v.Length == 8) {
          try {
            r = Convert.ToInt32(v.Substring(0,2), 16);
            g = Convert.ToInt32(v.Substring(2,2), 16);
            b = Convert.ToInt32(v.Substring(4,2), 16);
            if (v.Length == 8) a = Convert.ToInt32(v.Substring(6,2), 16);
          } catch { }
        }
        f.BorderColor = Color.FromArgb(255, r, g, b);
        f.BorderWidth = Math.Max(1, Math.Min(16, width));
        f.Opacity = Math.Max(0.05, Math.Min(1.0, a / 255.0));
        f.Invalidate();
      }

      static void RaiseTop(BorderForm f) {
        try {
          if (f == null || f.IsDisposed || !f.IsHandleCreated) return;
          SetWindowPos(f.Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        } catch { }
      }

      public static void Add(long hwnd, string color, int width) {
        Start();
        IntPtr h = new IntPtr(hwnd);
        IntPtr root = GetAncestor(h, 3);
        if (root == IntPtr.Zero) root = h;
        long rootId = root.ToInt64();
        lock (Sync) {
          RootToOrig[rootId] = hwnd;
          OrigToRoot[hwnd] = rootId;
          if (!Borders.ContainsKey(rootId)) {
            BorderForm f = null;
            Ui.BeginInvoke(new Action(() => {
              f = new BorderForm();
              ApplyStyle(f, color, width);
              f.Show();
              f.Visible = true;
              RaiseTop(f);
            }));
            while (f == null) Thread.Sleep(5);
            Borders[rootId] = f;
          } else {
            BorderForm f = Borders[rootId];
            try { f.BeginInvoke(new Action(() => ApplyStyle(f, color, width))); } catch { }
          }
        }
        RECT r;
        if (GetWindowRect(root, out r)) {
          UpdateBounds(rootId, r);
        }
      }

      public static void Remove(long hwnd) {
        long rootId = 0;
        BorderForm f = null;
        lock (Sync) {
          if (!OrigToRoot.TryGetValue(hwnd, out rootId)) return;
          OrigToRoot.Remove(hwnd);
          RootToOrig.Remove(rootId);
          Last.Remove(rootId);
          if (Borders.TryGetValue(rootId, out f)) Borders.Remove(rootId);
        }
        if (f != null) {
          try { f.BeginInvoke(new Action(() => f.Close())); } catch { }
        }
      }

      public static void UpdateStyle(long hwnd, string color, int width) {
        long rootId = 0;
        BorderForm f = null;
        lock (Sync) {
          if (!OrigToRoot.TryGetValue(hwnd, out rootId)) return;
          if (!Borders.TryGetValue(rootId, out f)) return;
        }
        try { f.BeginInvoke(new Action(() => { ApplyStyle(f, color, width); RaiseTop(f); })); } catch { }
      }

      static void UpdateBounds(long rootId, RECT r) {
        BorderForm f = null;
        lock (Sync) {
          if (!Borders.TryGetValue(rootId, out f)) return;
        }
        int w = Math.Max(1, r.Right - r.Left);
        int h = Math.Max(1, r.Bottom - r.Top);
        try {
          f.BeginInvoke(new Action(() => {
            if (f.IsDisposed) return;
            f.Bounds = new Rectangle(r.Left, r.Top, w, h);
            f.Invalidate();
            RaiseTop(f);
          }));
        } catch { }
      }

      static void Callback(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime) {
        if (hwnd == IntPtr.Zero) return;
        if (idObject != 0 || idChild != 0) return;
        bool forceRaise = (eventType == 0x0003);
        IntPtr root = GetAncestor(hwnd, 3);
        if (root == IntPtr.Zero) root = hwnd;
        long rootId = root.ToInt64();

        bool watched = false;
        lock (Sync) { watched = Borders.ContainsKey(rootId); }
        if (!watched) return;

        RECT r;
        if (!GetWindowRect(root, out r)) return;

        string rectKey = r.Left.ToString() + "," + r.Top.ToString() + "," + r.Right.ToString() + "," + r.Bottom.ToString();
        if (!forceRaise) {
          lock (Sync) {
            string prev;
            if (Last.TryGetValue(rootId, out prev) && prev == rectKey) return;
            Last[rootId] = rectKey;
          }
        } else {
          lock (Sync) { Last[rootId] = rectKey; }
        }
        UpdateBounds(rootId, r);
      }
    }
`

export const PINNED_BORDER_RUNNER_PS = `
  $in = [Console]::In
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $ErrorActionPreference = 'Stop'

  try {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    Add-Type -AssemblyName System.Drawing | Out-Null
    Add-Type @"
${PINNED_BORDER_CS}
"@
    [PinnedBorder]::Start()
  } catch {
    [Console]::Error.WriteLine(($_ | Out-String))
    exit 1
  }

  while ($true) {
    $line = $in.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq '__EXIT__') { break }
    if (-not $line.Trim()) { continue }
    $parts = $line.Split('|')
    $cmd = $parts[0]
    try {
      if ($cmd -eq 'ADD') {
        $hwnd = [Int64]$parts[1]
        $color = [string]$parts[2]
        $w = [int]$parts[3]
        [PinnedBorder]::Add($hwnd, $color, $w)
      } elseif ($cmd -eq 'DEL') {
        $hwnd = [Int64]$parts[1]
        [PinnedBorder]::Remove($hwnd)
      } elseif ($cmd -eq 'SET') {
        $hwnd = [Int64]$parts[1]
        $color = [string]$parts[2]
        $w = [int]$parts[3]
        [PinnedBorder]::UpdateStyle($hwnd, $color, $w)
      } elseif ($cmd -eq 'CLR') {
        [PinnedBorder]::Stop()
        [PinnedBorder]::Start()
      }
    } catch { }
  }

  try { [PinnedBorder]::Stop() } catch { }
  exit
`
