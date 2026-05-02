'use client';

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import type { Proposal } from '../types';

interface ProposalItemProps {
  proposal: Proposal;
}

export default function ProposalItem({ proposal }: ProposalItemProps) {
  const [showModal, setShowModal] = useState(false);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Available':
        return '#10B981';
      case 'Not Available':
        return '#6B7280';
      default:
        return '#6B7280';
    }
  };

  const getStatusBackgroundColor = (status: string) => {
    switch (status) {
      case 'Available':
        return '#D1FAE5';
      case 'Not Available':
        return '#F3F4F6';
      default:
        return '#F3F4F6';
    }
  };

  return (
    <>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            {proposal.title}
          </Text>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: getStatusBackgroundColor(proposal.status) },
            ]}
          >
            <Text
              style={[
                styles.statusText,
                { color: getStatusColor(proposal.status) },
              ]}
            >
              {proposal.status}
            </Text>
          </View>
        </View>

        <View style={styles.meta}>
          <Text style={styles.metaText}>Created: {proposal.createdAt}</Text>
          <Text style={styles.metaText}>
            Approvals: {proposal.approvals}/{proposal.required}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.viewButton}
          onPress={() => setShowModal(true)}
          accessibilityLabel={`View proposal ${proposal.title}`}
          accessibilityRole='button'
        >
          <Text style={styles.viewButtonText}>View</Text>
        </TouchableOpacity>
      </View>

      {/* Placeholder Modal */}
      <Modal
        visible={showModal}
        transparent
        animationType='fade'
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Proposal Details</Text>
            <Text style={styles.modalText}>Title: {proposal.title}</Text>
            <Text style={styles.modalText}>Status: {proposal.status}</Text>
            <Text style={styles.modalText}>Created: {proposal.createdAt}</Text>
            <Text style={styles.modalText}>
              Approvals: {proposal.approvals}/{proposal.required}
            </Text>
            <Text style={styles.modalNote}>
              TODO: Implement full proposal details and approval functionality
            </Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowModal(false)}
              accessibilityLabel='Close modal'
              accessibilityRole='button'
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    lineHeight: 22,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 80,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  metaText: {
    fontSize: 14,
    color: '#6B7280',
  },
  viewButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
  },
  viewButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 16,
  },
  modalText: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 8,
  },
  modalNote: {
    fontSize: 12,
    color: '#9CA3AF',
    fontStyle: 'italic',
    marginTop: 12,
    marginBottom: 20,
  },
  closeButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '500',
  },
});
