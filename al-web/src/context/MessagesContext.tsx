import { createContext, useContext } from 'react';
import { firestoreMessagesService, type MessagesService } from '../services/messagesService';

// Production listens to Firestore and writes through al-core; tests provide a fake.
export const MessagesServiceContext = createContext<MessagesService>(firestoreMessagesService);

export function useMessagesService() {
  return useContext(MessagesServiceContext);
}
