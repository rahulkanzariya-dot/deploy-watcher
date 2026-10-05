import './Toast.css';

export default function Toast({ message, visible }) {
  return (
    <div className={`toast${visible ? ' toast--show' : ''}`}>
      {message}
    </div>
  );
}
