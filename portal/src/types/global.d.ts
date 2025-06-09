// Extend the Window interface to include our global messageHandler
interface Window {
  messageHandler?: import('../core/messenger/MessageHandler').MessageHandler;
}
