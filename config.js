// Firebase 설정 파일입니다. null로 바꾸면 이 기기에만 저장되는 '로컬 모드'로 동작합니다.
// apiKey는 비밀번호가 아니라 프로젝트를 가리키는 공개 식별자이며, 데이터는 Firestore 보안 규칙이 보호합니다.

export const firebaseConfig = {
  apiKey: "AIzaSyCkEm6k67U-7ccZmpB_B4TpQvlL7F8VFbk",
  authDomain: "planerr-69a5a.firebaseapp.com",
  projectId: "planerr-69a5a",
  storageBucket: "planerr-69a5a.firebasestorage.app",
  messagingSenderId: "301322035684",
  appId: "1:301322035684:web:142099462485939ca467f1"
};

// 구글 캘린더 연동용 OAuth 클라이언트 ID(Google Cloud 콘솔에서 만든 '웹 애플리케이션' 클라이언트).
// 비워 두면 캘린더 연동 없이 앱 안 알람만 동작합니다. 이 값도 공개되어도 괜찮은 식별자입니다.
export const googleClientId = '';
