import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const socket: Socket = io("https://videocalling-backend-production.up.railway.app/", { 
  transports: ["websocket"] 
});

interface User { id: string; username: string; busy: boolean; }
interface Message { sender: string; text: string; time: string; date: string; }

function App() {
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const [loggedIn, setLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [chatHistory, setChatHistory] = useState<{ [key: string]: Message[] }>({});
  const [chatInput, setChatInput] = useState("");

  const [micActive, setMicActive] = useState(true);
  const [videoActive, setVideoActive] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isInCall, setIsInCall] = useState(false);

  // --- Logic remains unchanged ---
  useEffect(() => {
    socket.on("login-success", () => setLoggedIn(true));
    socket.on("online-users", (list: User[]) => setUsers(list.filter(u => u.id !== socket.id)));
    socket.on("incoming-call", (data) => setIncomingCall(data));

    socket.on("call-accepted", async ({ answer }) => {
      if (peerRef.current) {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        while (pendingCandidates.current.length > 0) {
          const c = pendingCandidates.current.shift();
          if (c) await peerRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
        }
        setIsInCall(true);
      }
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      if (peerRef.current?.remoteDescription) {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      } else {
        pendingCandidates.current.push(candidate);
      }
    });

    socket.on("receive-message", ({ from, message, time }) => {
      const today = new Date().toLocaleDateString();
      setChatHistory(prev => ({
        ...prev,
        [from]: [...(prev[from] || []), { sender: "Partner", text: message, time, date: today }]
      }));
    });

    socket.on("call-ended", cleanupCall);
    return () => { socket.off(); };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isChatOpen]);

  useEffect(() => {
    if (loggedIn) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
          localStreamRef.current = stream;
          if (localVideo.current) localVideo.current.srcObject = stream;
        })
        .catch(() => alert("Camera access required."));
    }
  }, [loggedIn]);

  const handleLogout = () => {
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    cleanupCall();
    setLoggedIn(false);
    window.location.reload(); 
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicActive(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoActive(videoTrack.enabled);
      }
    }
  };

  const createPeer = (targetId: string) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    localStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
    pc.ontrack = (e) => { if (remoteVideo.current) remoteVideo.current.srcObject = e.streams[0]; };
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit("ice-candidate", { to: targetId, candidate: e.candidate }); };
    peerRef.current = pc;
    return pc;
  };

  const callUser = async () => {
    if (!selectedUser) return;
    const pc = createPeer(selectedUser.id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("call-user", { to: selectedUser.id, offer });
    setIsInCall(true);
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    const pc = createPeer(incomingCall.from);
    setSelectedUser({ id: incomingCall.from, username: incomingCall.callerName, busy: true });
    await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer-call", { to: incomingCall.from, answer });
    while (pendingCandidates.current.length > 0) {
      const c = pendingCandidates.current.shift();
      if (c) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
    }
    setIncomingCall(null);
    setIsInCall(true);
  };

  function cleanupCall() {
    peerRef.current?.close();
    peerRef.current = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    pendingCandidates.current = [];
    setIsInCall(false);
  }

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedUser) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString();
    socket.emit("send-message", { to: selectedUser.id, message: chatInput });
    setChatHistory(prev => ({
      ...prev,
      [selectedUser.id]: [...(prev[selectedUser.id] || []), { sender: "You", text: chatInput, time, date }]
    }));
    setChatInput("");
  };

  if (!loggedIn) return (
    <div className="flex items-center justify-center min-h-screen bg-[#050505] p-6">
      <div className="bg-[#111] p-10 rounded-[2.5rem] w-full max-w-sm border border-white/5 shadow-2xl">
        <h2 className="text-3xl font-black mb-10 text-center bg-linear-to-b from-white to-white/40 bg-clip-text text-transparent">Gemini Meet</h2>
        <div className="space-y-4">
          <input className="w-full p-4 bg-[#1a1a1a] rounded-2xl border border-white/5 text-white outline-none focus:border-blue-500 transition-all text-sm" placeholder="Username" onChange={e => setUsername(e.target.value)} />
          <input className="w-full p-4 bg-[#1a1a1a] rounded-2xl border border-white/5 text-white outline-none focus:border-blue-500 transition-all text-sm" type="password" placeholder="Password" onChange={e => setPassword(e.target.value)} />
          <button className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-2xl font-bold text-white shadow-xl transition-all active:scale-95 mt-4" onClick={() => socket.emit("login", { username, password })}>Enter Workspace</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh bg-black text-white font-sans overflow-hidden">
      
      {/* 1. Responsive Sidebar Overlay */}
      <div className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:relative z-70 w-full sm:w-80 h-full bg-[#0a0a0a] border-r border-white/5 flex flex-col transition-transform duration-300`}>
        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#0d0d0d]">
          <div className="truncate">
            <p className="text-[9px] text-blue-500 font-black uppercase tracking-[0.2em]">Logged In As</p>
            <h1 className="text-lg font-bold truncate">{username}</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={handleLogout} className="p-2.5 bg-white/5 rounded-xl text-red-500 hover:bg-red-500/10 transition-all" title="Logout">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </button>
            <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2.5 bg-white/5 rounded-xl text-gray-400">✕</button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-hide">
          <p className="text-[10px] text-gray-500 font-bold uppercase p-2 tracking-widest">Active Members</p>
          {users.map(u => (
            <button key={u.id} onClick={() => { setSelectedUser(u); setIsSidebarOpen(false); }}
              className={`w-full text-left p-4 rounded-2xl flex items-center justify-between transition-all group ${selectedUser?.id === u.id ? 'bg-blue-600/10 border border-blue-500/30' : 'hover:bg-white/5 border border-transparent'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${u.busy ? 'bg-red-500 shadow-[0_0_8px_red]' : 'bg-green-500 shadow-[0_0_8px_green]'}`}></div>
                <span className={`text-sm font-medium ${selectedUser?.id === u.id ? 'text-blue-400' : 'text-gray-300 group-hover:text-white'}`}>{u.username}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Main Workspace */}
      <div className="flex-1 flex flex-col relative min-w-0">
        
        {/* Transparent Header */}
        <div className="absolute top-0 left-0 right-0 p-4 lg:p-6 flex justify-between items-center z-40 pointer-events-none">
          <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-3 bg-black/60 backdrop-blur-xl rounded-2xl border border-white/10 pointer-events-auto active:scale-90 transition-all">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7" /></svg>
          </button>
          {selectedUser && (
            <div className="bg-black/60 backdrop-blur-xl px-5 py-2.5 rounded-[1.2rem] border border-white/10 pointer-events-auto flex items-center gap-3 ml-auto lg:ml-0">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
              <h2 className="text-sm font-bold tracking-tight">{selectedUser.username}</h2>
            </div>
          )}
        </div>

        {/* Video Stage */}
        <div className="flex-1 relative bg-[#050505] flex items-center justify-center overflow-hidden">
          {isInCall ? (
            <video ref={remoteVideo} autoPlay playsInline className="w-full h-full object-cover" />
          ) : (
            <div className="text-center space-y-8 px-6 max-w-sm animate-in fade-in duration-700">
               <div className="w-24 h-24 bg-linear-to-tr from-blue-600 to-indigo-500 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl rotate-12">
                  <svg className="w-10 h-10 -rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
               </div>
               <div>
                  <h3 className="text-2xl font-black mb-2 tracking-tight">Ready to connect?</h3>
                  <p className="text-gray-500 text-sm font-medium">Pick a contact and start a private high-quality video session.</p>
               </div>
               {selectedUser && !selectedUser.busy && (
                  <button onClick={callUser} className="w-full bg-white text-black py-4 rounded-3xl font-black text-sm tracking-widest uppercase hover:bg-gray-200 transition-all shadow-xl shadow-white/5 active:scale-95">Start Call</button>
               )}
            </div>
          )}

          {/* Local PiP (Responsive Size) */}
          <div className={`absolute bottom-28 left-4 lg:bottom-4  w-[35%] sm:w-48 lg:w-72 aspect-video bg-[#111] rounded-3xl lg:rounded-lg overflow-hidden border border-white/10 shadow-2xl z-45 transition-all duration-500 ${isChatOpen ? 'lg:right-100' : ''}`}>
             {!videoActive && <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500 font-bold">MUTED</div>}
             <video ref={localVideo} autoPlay muted playsInline className={`w-full h-full object-cover scale-x-[-1] ${!videoActive ? 'opacity-0' : 'opacity-100'}`} />
          </div>
        </div>

        {/* 3. Floating Control Bar */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 lg:gap-6 px-5 py-3 lg:px-8 lg:py-4 bg-white/5 backdrop-blur-2xl rounded-4xl border border-white/10 shadow-2xl z-80">
          <button onClick={toggleMic} className={`p-3.5 lg:p-4 rounded-full transition-all active:scale-90 ${micActive ? 'bg-white/5 hover:bg-white/10' : 'bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.4)]'}`}>
            {micActive ? <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg> : "🔇"}
          </button>
          
          <button onClick={toggleVideo} className={`p-3.5 lg:p-4 rounded-full transition-all active:scale-90 ${videoActive ? 'bg-white/5 hover:bg-white/10' : 'bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.4)]'}`}>
            {videoActive ? <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> : "📵"}
          </button>

          {isInCall && (
            <button onClick={() => { socket.emit("end-call", { to: selectedUser?.id }); cleanupCall(); }} className="p-4 bg-red-600 hover:bg-red-500 rounded-full shadow-2xl rotate-135 active:scale-95 transition-all">
               <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" /></svg>
            </button>
          )}

          <button onClick={() => setIsChatOpen(!isChatOpen)} className={`p-3.5 lg:p-4 rounded-full transition-all relative ${isChatOpen ? 'bg-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.4)]' : 'bg-white/5 hover:bg-white/10'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
            {!isChatOpen && <div className="absolute top-0 right-0 w-2 h-2 bg-blue-500 rounded-full animate-ping"></div>}
          </button>
        </div>

        {/* 4. Sliding Chat Panel (Now with Date Labels) */}
        <div className={`fixed lg:absolute top-0 right-0 h-full bg-[#0d0d0d] lg:bg-[#0d0d0d]/80 lg:backdrop-blur-3xl border-l border-white/5 shadow-2xl transition-all duration-500 z-90 flex flex-col ${isChatOpen ? 'w-full lg:w-95 translate-x-0' : 'w-0 translate-x-full'}`}>
          <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#111]">
            <div>
              <h3 className="font-black text-sm uppercase tracking-widest">Live Chat</h3>
              <p className="text-[9px] text-gray-500 font-bold">{selectedUser?.username}</p>
            </div>
            <button onClick={() => setIsChatOpen(false)} className="p-2 bg-white/5 rounded-xl hover:bg-white/10">✕</button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide bg-linear-to-b from-[#0d0d0d] to-black">
            {selectedUser && (chatHistory[selectedUser.id] || []).map((m, i, arr) => {
              const showDate = i === 0 || arr[i-1].date !== m.date;
              return (
                <div key={i} className="flex flex-col">
                  {showDate && (
                    <div className="flex items-center gap-4 my-6">
                      <div className="flex-1 h-px bg-white/5"></div>
                      <span className="text-[10px] font-black text-gray-600 uppercase tracking-tighter">{m.date === new Date().toLocaleDateString() ? "Today" : m.date}</span>
                      <div className="flex-1 h-px bg-white/5"></div>
                    </div>
                  )}
                  <div className={`flex flex-col ${m.sender === "You" ? "items-end" : "items-start"}`}>
                    <div className={`px-4 py-3 rounded-2xl text-[13px] max-w-[85%] leading-relaxed ${m.sender === "You" ? "bg-blue-600 text-white rounded-tr-none shadow-lg shadow-blue-900/10" : "bg-[#1a1a1a] text-gray-200 rounded-tl-none border border-white/5"}`}>
                      {m.text}
                    </div>
                    <span className="text-[9px] text-gray-600 mt-1.5 font-bold tracking-tight px-1 uppercase">{m.time}</span>
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={sendMessage} className="p-4 bg-[#111] border-t border-white/5 flex gap-3 items-center">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type a message..." className="flex-1 bg-[#1a1a1a] rounded-2xl px-5 py-4 text-xs outline-none focus:border-blue-500/50 border border-transparent transition-all" />
            <button type="submit" className="bg-blue-600 hover:bg-blue-500 p-4 rounded-2xl shadow-xl shadow-blue-600/20 active:scale-90 transition-all">
               <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          </form>
        </div>
      </div>

      {/* 5. Full-Screen Call Modal */}
      {incomingCall && (
        <div className="fixed inset-0 bg-black z-100 flex items-center justify-center p-8 animate-in fade-in duration-500">
           <div className="absolute inset-0 bg-linear-to-b from-blue-900/20 to-black opacity-50"></div>
           <div className="relative text-center w-full max-w-sm">
              <div className="w-28 h-28 bg-blue-600 rounded-[3rem] flex items-center justify-center mx-auto mb-10 shadow-[0_0_60px_rgba(37,99,235,0.4)] animate-bounce">
                <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
              </div>
              <h2 className="text-4xl font-black mb-2 tracking-tighter">{incomingCall.callerName}</h2>
              <p className="text-blue-500 font-bold uppercase tracking-[0.3em] text-[10px] mb-16">Requesting Video Session</p>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={acceptCall} className="bg-white text-black py-5 rounded-3xl font-black text-sm uppercase tracking-widest active:scale-95 transition-all">Accept</button>
                <button onClick={() => setIncomingCall(null)} className="bg-red-500/10 text-red-500 border border-red-500/20 py-5 rounded-3xl font-black text-sm uppercase tracking-widest active:scale-95 transition-all">Ignore</button>
              </div>
           </div>
        </div>
      )}

      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}

export default App;