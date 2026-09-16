import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

export type ClientPlatform = 'mobile_ios' | 'mobile_android' | 'admin_web';

export interface LegalDocumentSummary {
  document_id: string;
  version: string;
  title: string;
  content_markdown: string;
  content_sha256: string;
  is_accepted: boolean;
  is_viewed: boolean;
}

export interface LegalAcceptanceStatus {
  gate_enabled: boolean;
  can_continue: boolean;
  terms: LegalDocumentSummary | null;
  privacy: LegalDocumentSummary | null;
}

export const getClientPlatform = (): ClientPlatform => {
  if (Platform.OS === 'ios') return 'mobile_ios';
  if (Platform.OS === 'android') return 'mobile_android';
  return 'admin_web';
};

export const legalService = {
  /**
   * Evaluates whether active legal documents exist and whether the caller has accepted them.
   * Fails closed: throws if RPC fails.
   */
  async getLegalAcceptanceStatus(): Promise<LegalAcceptanceStatus> {
    const { data, error } = await supabase.rpc('get_legal_acceptance_status' as any);
    if (error) {
      console.error('[legalService] getLegalAcceptanceStatus error:', error);
      throw error;
    }
    return data as LegalAcceptanceStatus;
  },

  /**
   * Server-side proof that the user opened and viewed the document in full inside the app.
   */
  async recordLegalDocumentView(documentId: string): Promise<void> {
    const platform = getClientPlatform();
    const { error } = await supabase.rpc('record_legal_document_view' as any, {
      _document_id: documentId,
      _client_platform: platform,
    });
    if (error) {
      console.error('[legalService] recordLegalDocumentView error:', error);
      throw error;
    }
  },

  /**
   * Records explicit acceptance of both active documents.
   * Requires proof of presentation (both documents viewed).
   */
  async acceptLegalDocuments(termsDocumentId: string, privacyDocumentId: string): Promise<void> {
    const platform = getClientPlatform();
    const userAgent = `${Platform.OS} JezSy-Mobile-App`;
    const { error } = await supabase.rpc('accept_legal_documents' as any, {
      _terms_document_id: termsDocumentId,
      _privacy_document_id: privacyDocumentId,
      _client_platform: platform,
      _user_agent: userAgent,
    });
    if (error) {
      console.error('[legalService] acceptLegalDocuments error:', error);
      throw error;
    }
  },

  /**
   * Fetches the current active legal document of a specific type (e.g. for reading in Profile/FAQ).
   */
  async getActiveDocument(type: 'terms' | 'privacy') {
    const { data, error } = await (supabase as any)
      .from('legal_documents')
      .select('*')
      .eq('document_type', type)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error(`[legalService] getActiveDocument(${type}) error:`, error);
      throw error;
    }
    return data;
  },
};
