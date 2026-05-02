'use client';

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MemberRow from './MemberRow';

interface MembersListProps {
  members: string[];
  onChange: (members: string[]) => void;
  errors: Record<string, string>;
}

export default function MembersList({
  members,
  onChange,
  errors,
}: MembersListProps) {
  const addMember = () => {
    onChange([...members, '']);
  };

  const removeMember = (index: number) => {
    const newMembers = members.filter((_, i) => i !== index);
    onChange(newMembers);
  };

  const updateMember = (index: number, value: string) => {
    const newMembers = [...members];
    newMembers[index] = value;
    onChange(newMembers);
  };

  const hasMembers = members.some((member) => member.trim());

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Members *</Text>

      {members.length === 0 || !hasMembers ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>Add at least one member</Text>
        </View>
      ) : null}

      {members.map((member, index) => (
        <MemberRow
          key={index}
          value={member}
          onChange={(value) => updateMember(index, value)}
          onRemove={() => removeMember(index)}
          error={errors[`member-${index}`]}
          canRemove={members.length > 1}
          placeholder={`Member ${index + 1} address`}
        />
      ))}

      <TouchableOpacity
        style={styles.addButton}
        onPress={addMember}
        accessibilityLabel='Add member button'
        accessibilityRole='button'
      >
        <Text style={styles.addButtonText}>+ Add Member</Text>
      </TouchableOpacity>

      {errors.members && <Text style={styles.errorText}>{errors.members}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  emptyState: {
    padding: 20,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyStateText: {
    color: '#6B7280',
    fontSize: 14,
  },
  addButton: {
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: '#F8FAFC',
  },
  addButtonText: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '500',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    marginTop: 4,
  },
});
